const mysql = require('mysql2/promise');
require('dotenv').config();

// Railway provides MYSQLHOST, MYSQLPORT etc. automatically
// Falls back to DB_HOST etc. for local development
const pool = mysql.createPool({
  host:     process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
  port:     process.env.MYSQLPORT     || process.env.DB_PORT     || 3306,
  user:     process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'bus_ticketing',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.MYSQLHOST ? { rejectUnauthorized: false } : undefined,
});

module.exports = pool;
