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

// Streaming SSE proxy to OpenRouter chat completions
// POST /api/v1/chat/completions  { messages: [...], ...optional }
app.post('/api/v1/chat/completions', async (req, res) => {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const DEFAULT_MODEL = process.env.OPENROUTER_MODEL;
  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured in backend/.env' });
  }

  const body = req.body || {};
  const model = body.model || DEFAULT_MODEL;
  if (!model) {
    return res.status(400).json({ error: 'model missing and OPENROUTER_MODEL not set' });
  }

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const upstreamBody = {
    ...body,
    model,
    stream: true,
  };

  // Prepare SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  try {
    const referer = req.headers['origin'] || req.headers['referer'] || 'http://localhost:3000';
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'HTTP-Referer': referer,
        'X-Title': process.env.OPENROUTER_TITLE || 'app-web-builder',
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });

    if (!orRes.ok) {
      const text = await orRes.text().catch(() => '');
      res.write(`data: ${JSON.stringify({ error: `OpenRouter error ${orRes.status}`, detail: text })}\n\n`);
      return res.end();
    }

    const reader = orRes.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(value);
    }
    res.end();
  } catch (err) {
    const msg = (err && err.name === 'AbortError') ? 'client_disconnected' : (err && err.message) ? err.message : String(err);
    // Ensure valid SSE frame on error if headers already sent
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    } else {
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
