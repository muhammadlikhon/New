const db     = require('../config/db');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// Utility: generate a short unique booking code
const makeCode = (prefix = 'BK') =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;

// POST /api/bookings   — passenger or counter_manager
const createBooking = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { schedule_id, seat_ids, passenger_name, contact_number } = req.body;
    const userId = req.user.id;

    if (!schedule_id || !seat_ids || seat_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'schedule_id and seat_ids are required.' });
    }

    // Lock schedule row
    const [[schedule]] = await conn.query(
      'SELECT * FROM schedules WHERE id = ? AND status = "active" FOR UPDATE',
      [schedule_id]
    );
    if (!schedule) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Schedule not found or inactive.' });
    }
    if (schedule.available_seats < seat_ids.length) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Not enough available seats.' });
    }

    // Check seats are actually free
    const [taken] = await conn.query(
      `SELECT bs.seat_id FROM booking_seats bs
       JOIN bookings bk ON bs.booking_id = bk.id
       WHERE bk.schedule_id = ? AND bk.status IN ('pending','confirmed') AND bs.seat_id IN (?)`,
      [schedule_id, seat_ids]
    );
    if (taken.length > 0) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'One or more selected seats are already booked.' });
    }

    const totalFare      = schedule.ticket_price * seat_ids.length;
    const booking_code   = makeCode('BK');
    const bookedBy       = req.user.role === 'counter_manager' ? 'counter_manager' : 'passenger';

    // Resolve passenger: counter_manager provides passenger_name + contact_number
    let passengerId = userId;
    if (bookedBy === 'counter_manager') {
      // Find or create a guest user record for the walk-in passenger
      const [existing] = await conn.query('SELECT id FROM users WHERE phone = ?', [contact_number]);
      if (existing.length > 0) {
        passengerId = existing[0].id;
      } else {
        const dummyEmail = `guest_${contact_number}@counter.local`;
        const [inserted] = await conn.query(
          `INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, 'NO_LOGIN', 'passenger')`,
          [passenger_name || 'Walk-in Customer', dummyEmail, contact_number]
        );
        passengerId = inserted.insertId;
      }
    }

    // Insert booking
    const [bRes] = await conn.query(
      `INSERT INTO bookings (passenger_id, schedule_id, booking_code, total_fare, status, booked_by)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [passengerId, schedule_id, booking_code, totalFare, bookedBy]
    );
    const bookingId = bRes.insertId;

    // Insert booking_seats
    for (const seatId of seat_ids) {
      await conn.query('INSERT INTO booking_seats (booking_id, seat_id) VALUES (?, ?)', [bookingId, seatId]);
    }

    // Decrease available seats
    await conn.query(
      'UPDATE schedules SET available_seats = available_seats - ? WHERE id = ?',
      [seat_ids.length, schedule_id]
    );

    await conn.commit();
    return res.status(201).json({
      success: true,
      message: 'Booking created. Proceed to payment.',
      data: { booking_id: bookingId, booking_code, total_fare: totalFare }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Create booking error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// POST /api/bookings/:id/pay
const confirmPayment = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id } = req.params;
    const { method, transaction_id, amount } = req.body;

    const [[booking]] = await conn.query(
      'SELECT * FROM bookings WHERE id = ? AND passenger_id = ? FOR UPDATE',
      [id, req.user.role === 'counter_manager' ? booking?.passenger_id : req.user.id]
    );

    // Allow counter managers to pay any booking they created
    const [[bk]] = await conn.query(
      'SELECT * FROM bookings WHERE id = ?', [id]
    );
    if (!bk) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }
    if (bk.status !== 'pending') {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Booking is not in pending state.' });
    }

    // Insert payment
    await conn.query(
      `INSERT INTO payments (booking_id, transaction_id, amount, method, status, paid_at)
       VALUES (?, ?, ?, ?, 'success', NOW())`,
      [id, transaction_id || uuidv4(), amount || bk.total_fare, method || 'bKash']
    );

    // Update booking status
    await conn.query('UPDATE bookings SET status = "confirmed" WHERE id = ?', [id]);

    // Generate ticket
    const ticket_code = makeCode('TK');
    const qrPayload   = JSON.stringify({ ticket_code, booking_code: bk.booking_code, booking_id: id });
    const qr_code     = await QRCode.toDataURL(qrPayload);

    await conn.query(
      'INSERT INTO tickets (booking_id, ticket_code, qr_code) VALUES (?, ?, ?)',
      [id, ticket_code, qr_code]
    );

    await conn.commit();
    return res.status(200).json({
      success: true,
      message: 'Payment confirmed. Ticket issued.',
      data: { ticket_code, qr_code }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Payment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
};

// GET /api/bookings/my  — passenger booking history
const getMyBookings = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        bk.id, bk.booking_code, bk.total_fare, bk.status, bk.booked_at,
        s.travel_date, s.departure_time, s.arrival_time,
        b.bus_name, b.bus_type,
        r.from_location, r.to_location,
        tk.ticket_code, tk.qr_code,
        GROUP_CONCAT(st.seat_number ORDER BY st.seat_number) AS seats
      FROM bookings bk
      JOIN schedules   s  ON bk.schedule_id = s.id
      JOIN buses       b  ON s.bus_id        = b.id
      JOIN routes      r  ON s.route_id      = r.id
      LEFT JOIN tickets tk ON bk.id           = tk.booking_id
      LEFT JOIN booking_seats bs ON bk.id     = bs.booking_id
      LEFT JOIN seats  st ON bs.seat_id       = st.id
      WHERE bk.passenger_id = ?
      GROUP BY bk.id
      ORDER BY bk.booked_at DESC
    `, [req.user.id]);

    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Get bookings error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/bookings/:id/cancel
const cancelBooking = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id } = req.params;
    const { reason } = req.body;

    const [[bk]] = await conn.query('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!bk || bk.passenger_id !== req.user.id) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }
    if (bk.status !== 'confirmed') {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Only confirmed bookings can be cancelled.' });
    }

    // Simple refund policy: 80% refund
    const [[payment]] = await conn.query('SELECT amount FROM payments WHERE booking_id = ?', [id]);
    const refundAmount = payment ? payment.amount * 0.8 : 0;

    await conn.query('UPDATE bookings SET status = "cancelled" WHERE id = ?', [id]);
    await conn.query(
      `INSERT INTO cancellations (booking_id, reason, refund_amount, refund_status)
       VALUES (?, ?, ?, 'pending')`,
      [id, reason || null, refundAmount]
    );

    // Return seats to schedule
    const [bs] = await conn.query('SELECT COUNT(*) AS cnt FROM booking_seats WHERE booking_id = ?', [id]);
    await conn.query(
      'UPDATE schedules SET available_seats = available_seats + ? WHERE id = ?',
      [bs[0].cnt, bk.schedule_id]
    );

    await conn.commit();
    return res.status(200).json({
      success: true,
      message: 'Booking cancelled.',
      data: { refund_amount: refundAmount, refund_status: 'pending' }
    });
  } catch (err) {
    await conn.rollback();
    console.error('Cancel booking error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
};

module.exports = { createBooking, confirmPayment, getMyBookings, cancelBooking };
