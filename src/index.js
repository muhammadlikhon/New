require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const routes  = require('./routes/index');
const initDB  = require('./initDB');

const app  = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Serve frontend from /public
app.use(express.static(path.join(__dirname, '../public')));

// All API routes
app.use('/api', routes);

// Any non-API route → serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// Init DB tables then start server
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`🚌 BDTickets server running on port ${PORT}`)
  );
});
