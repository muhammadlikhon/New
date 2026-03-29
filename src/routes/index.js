const express = require('express');
const router  = express.Router();

const { authenticate, authorize } = require('../middleware/auth');
const auth    = require('../controllers/authController');
const sched   = require('../controllers/scheduleController');
const booking = require('../controllers/bookingController');
const bus     = require('../controllers/busController');
const admin   = require('../controllers/adminController');

// ── AUTH ──────────────────────────────────────────────────
router.post('/auth/register', auth.register);
router.post('/auth/login',    auth.login);
router.get ('/auth/me',       authenticate, auth.getMe);

// ── SEARCH (public) ───────────────────────────────────────
router.get('/schedules/search',       sched.searchSchedules);
router.get('/schedules/:id',          sched.getScheduleById);

// ── PASSENGER ─────────────────────────────────────────────
router.get ('/bookings/my',           authenticate, authorize('passenger'), booking.getMyBookings);
router.post('/bookings',              authenticate, authorize('passenger','counter_manager'), booking.createBooking);
router.post('/bookings/:id/pay',      authenticate, authorize('passenger','counter_manager'), booking.confirmPayment);
router.post('/bookings/:id/cancel',   authenticate, authorize('passenger'), booking.cancelBooking);

// ── OPERATOR ──────────────────────────────────────────────
router.get ('/buses',                 authenticate, authorize('operator'), bus.getBuses);
router.post('/buses',                 authenticate, authorize('operator'), bus.createBus);
router.put ('/buses/:id',             authenticate, authorize('operator'), bus.updateBus);

router.get ('/routes',                authenticate, authorize('operator'), bus.getRoutes);
router.post('/routes',                authenticate, authorize('operator'), bus.createRoute);

router.get ('/schedules',             authenticate, authorize('operator'), sched.getOperatorSchedules);
router.post('/schedules',             authenticate, authorize('operator'), sched.createSchedule);

router.get ('/reports/operator',      authenticate, authorize('operator'), bus.operatorReport);

// ── ADMIN ─────────────────────────────────────────────────
router.get ('/admin/users',                     authenticate, authorize('admin'), admin.getAllUsers);
router.patch('/admin/users/:id/status',         authenticate, authorize('admin'), admin.updateUserStatus);
router.get ('/admin/operators/pending',         authenticate, authorize('admin'), admin.getPendingOperators);
router.patch('/admin/operators/:id/approve',    authenticate, authorize('admin'), admin.approveOperator);
router.get ('/admin/reports',                   authenticate, authorize('admin'), admin.systemReport);

module.exports = router;
