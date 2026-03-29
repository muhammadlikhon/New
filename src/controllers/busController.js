const db = require('../config/db');

// ── Helper ──────────────────────────────────────────────────
const getOperatorId = async (userId) => {
  const [rows] = await db.query('SELECT id FROM operators WHERE user_id = ?', [userId]);
  return rows.length > 0 ? rows[0].id : null;
};

// ════════════════════════════════════════════════════════════
// BUS MANAGEMENT
// ════════════════════════════════════════════════════════════

// GET /api/buses
const getBuses = async (req, res) => {
  try {
    const operatorId = await getOperatorId(req.user.id);
    if (!operatorId) return res.status(403).json({ success: false, message: 'Not an operator.' });

    const [rows] = await db.query(
      `SELECT b.*, COUNT(s.id) AS total_seat_records
       FROM buses b LEFT JOIN seats s ON b.id = s.bus_id
       WHERE b.operator_id = ?
       GROUP BY b.id
       ORDER BY b.id DESC`,
      [operatorId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/buses
const createBus = async (req, res) => {
  try {
    const operatorId = await getOperatorId(req.user.id);
    if (!operatorId) return res.status(403).json({ success: false, message: 'Not an operator.' });

    const { bus_name, reg_number, bus_type, total_seats, driver_name, driver_contact } = req.body;

    const [result] = await db.query(
      `INSERT INTO buses (operator_id, bus_name, reg_number, bus_type, total_seats, driver_name, driver_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [operatorId, bus_name, reg_number, bus_type, total_seats || 40, driver_name, driver_contact]
    );

    // Auto-generate seat records  (A1, A2 ... layout)
    const busId = result.insertId;
    const types = ['Window', 'Aisle', 'Middle'];
    const insertSeats = [];
    const rows_count = Math.ceil((total_seats || 40) / 4);
    const rowLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let seatNum = 1;
    for (let r = 0; r < rows_count && seatNum <= (total_seats || 40); r++) {
      for (let c = 1; c <= 4 && seatNum <= (total_seats || 40); c++) {
        const seatLabel = `${rowLetters[r]}${c}`;
        const seatType = c === 1 || c === 4 ? 'Window' : c === 2 ? 'Aisle' : 'Middle';
        insertSeats.push([busId, seatLabel, seatType]);
        seatNum++;
      }
    }
    if (insertSeats.length > 0) {
      await db.query('INSERT INTO seats (bus_id, seat_number, seat_type) VALUES ?', [insertSeats]);
    }

    return res.status(201).json({ success: true, message: 'Bus created with seat map.', data: { id: busId } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/buses/:id
const updateBus = async (req, res) => {
  try {
    const operatorId = await getOperatorId(req.user.id);
    const { bus_name, bus_type, driver_name, driver_contact, is_active } = req.body;

    await db.query(
      `UPDATE buses SET bus_name=?, bus_type=?, driver_name=?, driver_contact=?, is_active=?
       WHERE id=? AND operator_id=?`,
      [bus_name, bus_type, driver_name, driver_contact, is_active, req.params.id, operatorId]
    );
    return res.status(200).json({ success: true, message: 'Bus updated.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════
// ROUTE MANAGEMENT
// ════════════════════════════════════════════════════════════

// GET /api/routes
const getRoutes = async (req, res) => {
  try {
    const operatorId = await getOperatorId(req.user.id);
    const [rows] = await db.query(
      'SELECT * FROM routes WHERE operator_id = ? ORDER BY id DESC', [operatorId]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/routes
const createRoute = async (req, res) => {
  try {
    const operatorId = await getOperatorId(req.user.id);
    const { from_location, to_location, distance_km, estimated_minutes } = req.body;

    const [result] = await db.query(
      `INSERT INTO routes (operator_id, from_location, to_location, distance_km, estimated_minutes)
       VALUES (?, ?, ?, ?, ?)`,
      [operatorId, from_location, to_location, distance_km, estimated_minutes]
    );
    return res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ════════════════════════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════════════════════════

// GET /api/reports/operator?from=2026-01-01&to=2026-03-31
const operatorReport = async (req, res) => {
  try {
    const operatorId = await getOperatorId(req.user.id);
    const { from, to } = req.query;

    const [summary] = await db.query(`
      SELECT
        COUNT(bk.id)                              AS total_bookings,
        SUM(CASE WHEN bk.status='confirmed' THEN 1 ELSE 0 END) AS confirmed_bookings,
        SUM(CASE WHEN bk.status='cancelled' THEN 1 ELSE 0 END) AS cancelled_bookings,
        SUM(p.amount)                             AS total_revenue,
        AVG(p.amount)                             AS avg_fare
      FROM bookings bk
      JOIN schedules  s ON bk.schedule_id = s.id
      JOIN buses      b ON s.bus_id       = b.id
      LEFT JOIN payments p ON bk.id       = p.booking_id AND p.status = 'success'
      WHERE b.operator_id = ?
        ${from ? 'AND DATE(bk.booked_at) >= ?' : ''}
        ${to   ? 'AND DATE(bk.booked_at) <= ?' : ''}
    `, [operatorId, ...(from ? [from] : []), ...(to ? [to] : [])]);

    const [topRoutes] = await db.query(`
      SELECT r.from_location, r.to_location, COUNT(bk.id) AS bookings
      FROM bookings bk
      JOIN schedules s ON bk.schedule_id = s.id
      JOIN routes    r ON s.route_id     = r.id
      JOIN buses     b ON s.bus_id       = b.id
      WHERE b.operator_id = ? AND bk.status = 'confirmed'
      GROUP BY r.id ORDER BY bookings DESC LIMIT 5
    `, [operatorId]);

    return res.status(200).json({ success: true, data: { summary: summary[0], top_routes: topRoutes } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getBuses, createBus, updateBus, getRoutes, createRoute, operatorReport };
