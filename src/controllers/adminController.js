const db = require('../config/db');

// GET /api/admin/users
const getAllUsers = async (req, res) => {
  try {
    const { role, status } = req.query;
    let query = 'SELECT id, full_name, email, phone, role, status, created_at FROM users WHERE 1=1';
    const params = [];
    if (role)   { query += ' AND role = ?';   params.push(role); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    query += ' ORDER BY created_at DESC';

    const [rows] = await db.query(query, params);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PATCH /api/admin/users/:id/status
const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    await db.query('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    return res.status(200).json({ success: true, message: `User ${status}.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/admin/operators/pending
const getPendingOperators = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT op.id, op.company_name, op.business_license, op.approval_status,
             u.full_name, u.email, u.phone, u.created_at
      FROM operators op JOIN users u ON op.user_id = u.id
      WHERE op.approval_status = 'pending'
      ORDER BY u.created_at DESC
    `);
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PATCH /api/admin/operators/:id/approve
const approveOperator = async (req, res) => {
  try {
    const { decision } = req.body; // 'approved' | 'rejected'
    await db.query(
      'UPDATE operators SET approval_status = ?, approved_at = NOW() WHERE id = ?',
      [decision, req.params.id]
    );
    return res.status(200).json({ success: true, message: `Operator ${decision}.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/admin/reports
const systemReport = async (req, res) => {
  try {
    const [[revenue]] = await db.query(`
      SELECT
        SUM(p.amount)                                    AS total_revenue,
        SUM(CASE WHEN DATE(p.paid_at) = CURDATE() THEN p.amount ELSE 0 END) AS today_revenue,
        COUNT(DISTINCT p.booking_id)                     AS total_payments,
        SUM(CASE WHEN p.method = 'bKash'  THEN 1 ELSE 0 END) AS bkash_count,
        SUM(CASE WHEN p.method = 'Nagad'  THEN 1 ELSE 0 END) AS nagad_count,
        SUM(CASE WHEN p.method = 'Card'   THEN 1 ELSE 0 END) AS card_count,
        SUM(CASE WHEN p.method = 'Cash'   THEN 1 ELSE 0 END) AS cash_count
      FROM payments p WHERE p.status = 'success'
    `);

    const [[counts]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='passenger') AS passengers,
        (SELECT COUNT(*) FROM operators WHERE approval_status='approved') AS operators,
        (SELECT COUNT(*) FROM buses) AS buses,
        (SELECT COUNT(*) FROM bookings WHERE status='confirmed') AS confirmed_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status='cancelled') AS cancelled_bookings
    `);

    const [topRoutes] = await db.query(`
      SELECT r.from_location, r.to_location, COUNT(bk.id) AS bookings
      FROM bookings bk
      JOIN schedules s ON bk.schedule_id = s.id
      JOIN routes    r ON s.route_id     = r.id
      WHERE bk.status = 'confirmed'
      GROUP BY r.id ORDER BY bookings DESC LIMIT 10
    `);

    return res.status(200).json({
      success: true,
      data: { revenue, counts, top_routes: topRoutes }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getAllUsers, updateUserStatus, getPendingOperators, approveOperator, systemReport };
