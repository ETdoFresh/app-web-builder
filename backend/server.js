const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { query } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'backend-api'
  });
});

// Simple DB health endpoint: returns NOW() from Postgres
app.get('/api/db-health', async (req, res) => {
  try {
    const result = await query('SELECT NOW() as now');
    res.json({ ok: true, now: result.rows[0].now });
  } catch (err) {
    const detail = (err && err.message) ? err.message : String(err);
    console.error('DB health check failed:', detail);
    res.status(500).json({ ok: false, error: detail });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
