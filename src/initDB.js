// Runs once on startup to create all tables if they don't exist.
// Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS).
const db = require('./config/db');

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  UNIQUE NOT NULL,
  phone         VARCHAR(20)   UNIQUE NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  role          ENUM('passenger','operator','counter_manager','admin') NOT NULL DEFAULT 'passenger',
  national_id   VARCHAR(20)   NULL,
  status        ENUM('active','suspended','pending') NOT NULL DEFAULT 'active',
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operators (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT          NOT NULL UNIQUE,
  company_name     VARCHAR(150) NOT NULL,
  business_license VARCHAR(100) NOT NULL,
  approval_status  ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  approved_at      TIMESTAMP    NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS buses (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  operator_id    INT          NOT NULL,
  bus_name       VARCHAR(100) NOT NULL,
  reg_number     VARCHAR(50)  UNIQUE NOT NULL,
  bus_type       ENUM('AC','Non-AC','Sleeper') NOT NULL,
  total_seats    INT          NOT NULL DEFAULT 40,
  driver_name    VARCHAR(100) NULL,
  driver_contact VARCHAR(20)  NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seats (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  bus_id      INT  NOT NULL,
  seat_number VARCHAR(10) NOT NULL,
  seat_type   ENUM('Window','Aisle','Middle') NOT NULL DEFAULT 'Aisle',
  UNIQUE KEY uq_bus_seat (bus_id, seat_number),
  FOREIGN KEY (bus_id) REFERENCES buses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS routes (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  operator_id        INT           NOT NULL,
  from_location      VARCHAR(100)  NOT NULL,
  to_location        VARCHAR(100)  NOT NULL,
  distance_km        DECIMAL(8,2)  NULL,
  estimated_minutes  INT           NULL,
  is_active          TINYINT(1)    NOT NULL DEFAULT 1,
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedules (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  bus_id           INT           NOT NULL,
  route_id         INT           NOT NULL,
  travel_date      DATE          NOT NULL,
  departure_time   DATETIME      NOT NULL,
  arrival_time     DATETIME      NOT NULL,
  available_seats  INT           NOT NULL,
  ticket_price     DECIMAL(10,2) NOT NULL,
  status           ENUM('active','cancelled','completed') NOT NULL DEFAULT 'active',
  FOREIGN KEY (bus_id)   REFERENCES buses(id)   ON DELETE CASCADE,
  FOREIGN KEY (route_id) REFERENCES routes(id)  ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookings (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  passenger_id INT           NOT NULL,
  schedule_id  INT           NOT NULL,
  booking_code VARCHAR(20)   UNIQUE NOT NULL,
  total_fare   DECIMAL(10,2) NOT NULL,
  status       ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  booked_by    ENUM('passenger','counter_manager') NOT NULL DEFAULT 'passenger',
  booked_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (passenger_id) REFERENCES users(id)      ON DELETE RESTRICT,
  FOREIGN KEY (schedule_id)  REFERENCES schedules(id)  ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS booking_seats (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  seat_id    INT NOT NULL,
  UNIQUE KEY uq_booking_seat (booking_id, seat_id),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (seat_id)    REFERENCES seats(id)    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  booking_id     INT           NOT NULL UNIQUE,
  transaction_id VARCHAR(100)  NULL,
  amount         DECIMAL(10,2) NOT NULL,
  method         ENUM('bKash','Nagad','Rocket','Card','Cash') NOT NULL,
  status         ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  paid_at        TIMESTAMP     NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tickets (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  booking_id   INT          NOT NULL UNIQUE,
  ticket_code  VARCHAR(30)  UNIQUE NOT NULL,
  qr_code      TEXT         NOT NULL,
  issued_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cancellations (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  booking_id     INT           NOT NULL UNIQUE,
  reason         TEXT          NULL,
  refund_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  refund_status  ENUM('pending','processed','rejected') NOT NULL DEFAULT 'pending',
  cancelled_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);
`;

const bcrypt = require('bcryptjs');

const initDB = async () => {
  try {
    const statements = SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await db.query(stmt);
    }
    console.log('✅ All tables created / verified.');

    // Seed admin user if not exists
    const [admins] = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (admins.length === 0) {
      const hash = await bcrypt.hash('Admin@1234', 10);
      await db.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role)
         VALUES ('System Admin', 'admin@bdtickets.com', '01700000000', ?, 'admin')`,
        [hash]
      );
      console.log('✅ Admin seeded: admin@bdtickets.com / Admin@1234');
    }

    // Seed demo passenger
    const [passengers] = await db.query("SELECT id FROM users WHERE email='passenger@demo.com' LIMIT 1");
    if (passengers.length === 0) {
      const hash = await bcrypt.hash('demo123', 10);
      await db.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role)
         VALUES ('Rahim Uddin', 'passenger@demo.com', '01711111111', ?, 'passenger')`,
        [hash]
      );
      console.log('✅ Demo passenger seeded.');
    }

  } catch (err) {
    console.error('❌ DB init error:', err.message);
  }
};

module.exports = initDB;
