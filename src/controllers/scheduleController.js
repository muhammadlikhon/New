const db = require('../config/db');

// GET /api/schedules/search?from=Dhaka&to=Chittagong&date=2026-04-01&bus_type=AC
const searchSchedules = async (req, res) => {
  try {
    const { from, to, date, bus_type } = req.query;

    if (!from || !to || !date) {
      return res.status(400).json({ success: false, message: 'from, to, and date are required.' });
    }

    let query = `
      SELECT
        s.id            AS schedule_id,
        s.travel_date,
        s.departure_time,
        s.arrival_time,
        s.available_seats,
        s.ticket_price,
        b.id            AS bus_id,
        b.bus_name,
        b.bus_type,
        b.total_seats,
        r.from_location,
        r.to_location,
        r.distance_km,
        r.estimated_minutes,
        u.full_name     AS operator_name
      FROM schedules s
      JOIN buses    b ON s.bus_id   = b.id
      JOIN routes   r ON s.route_id = r.id
      JOIN operators op ON b.operator_id = op.id
      JOIN users    u  ON op.user_id     = u.id
      WHERE r.from_location = ?
        AND r.to_location   = ?
        AND s.travel_date   = ?
        AND s.status        = 'active'
        AND s.available_seats > 0
    `;
    const params = [from, to, date];

    if (bus_type) {
      query += ' AND b.bus_type = ?';
      params.push(bus_type);
    }

    query += ' ORDER BY s.departure_time ASC';

    const [rows] = await db.query(query, params);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Search schedules error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/schedules/:id  — full details including seat map
const getScheduleById = async (req, res) => {
  try {
    const { id } = req.params;

    const [schedules] = await db.query(`
      SELECT s.*, b.bus_name, b.bus_type, b.total_seats,
             r.from_location, r.to_location, r.distance_km, r.estimated_minutes,
             u.full_name AS operator_name
      FROM schedules s
      JOIN buses    b  ON s.bus_id     = b.id
      JOIN routes   r  ON s.route_id   = r.id
      JOIN operators op ON b.operator_id = op.id
      JOIN users    u  ON op.user_id     = u.id
      WHERE s.id = ?
    `, [id]);

    if (schedules.length === 0) {
      return res.status(404).json({ success: false, message: 'Schedule not found.' });
    }

    // Get seat availability for this schedule
    const [seats] = await db.query(`
      SELECT
        s.id, s.seat_number, s.seat_type,
        CASE WHEN bs.seat_id IS NOT NULL THEN 'Booked' ELSE 'Available' END AS status
      FROM seats s
      LEFT JOIN booking_seats bs ON s.id = bs.seat_id
        AND bs.booking_id IN (
          SELECT id FROM bookings
          WHERE schedule_id = ? AND status IN ('pending','confirmed')
        )
      WHERE s.bus_id = ?
      ORDER BY s.seat_number
    `, [id, schedules[0].bus_id]);

    return res.status(200).json({
      success: true,
      data: { ...schedules[0], seats }
    });
  } catch (err) {
    console.error('Get schedule error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Operator: GET /api/schedules  (own schedules)
const getOperatorSchedules = async (req, res) => {
  try {
    const [op] = await db.query('SELECT id FROM operators WHERE user_id = ?', [req.user.id]);
    if (op.length === 0) return res.status(403).json({ success: false, message: 'Not an operator.' });

    const [rows] = await db.query(`
      SELECT s.*, b.bus_name, r.from_location, r.to_location
      FROM schedules s
      JOIN buses  b ON s.bus_id   = b.id
      JOIN routes r ON s.route_id = r.id
      WHERE b.operator_id = ?
      ORDER BY s.travel_date DESC, s.departure_time DESC
    `, [op[0].id]);

    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('Operator schedules error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Operator: POST /api/schedules
const createSchedule = async (req, res) => {
  try {
    const { bus_id, route_id, travel_date, departure_time, arrival_time, ticket_price } = req.body;

    const [op] = await db.query('SELECT id FROM operators WHERE user_id = ?', [req.user.id]);
    if (op.length === 0) return res.status(403).json({ success: false, message: 'Not an operator.' });

    // Verify bus belongs to this operator
    const [bus] = await db.query(
      'SELECT total_seats FROM buses WHERE id = ? AND operator_id = ?',
      [bus_id, op[0].id]
    );
    if (bus.length === 0) return res.status(403).json({ success: false, message: 'Bus not found.' });

    const [result] = await db.query(
      `INSERT INTO schedules (bus_id, route_id, travel_date, departure_time, arrival_time, available_seats, ticket_price)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bus_id, route_id, travel_date, departure_time, arrival_time, bus[0].total_seats, ticket_price]
    );

    return res.status(201).json({ success: true, message: 'Schedule created.', data: { id: result.insertId } });
  } catch (err) {
    console.error('Create schedule error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { searchSchedules, getScheduleById, getOperatorSchedules, createSchedule };
