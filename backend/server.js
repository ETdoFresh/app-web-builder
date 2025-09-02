const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { query, ensureTables } = require('./db');

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
  const sessionId = body.session_id || req.headers['x-session-id'] || crypto.randomUUID();
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
    // Persist request payload (best-effort)
    try {
      const userContents = Array.isArray(body.messages)
        ? body.messages.filter(m => m && m.role === 'user').map(m => m.content).join('\n\n')
        : null;
      await query(
        'INSERT INTO chat_logs (session_id, direction, role, content, model, meta) VALUES ($1,$2,$3,$4,$5,$6)',
        [sessionId, 'request', null, userContents, model, JSON.stringify(body)]
      );
    } catch (e) {
      console.warn('Failed to persist request log:', e.message);
    }
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
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let assistantText = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        // Forward raw bytes to client immediately
        res.write(value);
        // Decode for local accumulation
        const chunk = decoder.decode(value, { stream: true });
        sseBuffer += chunk;
        let idx;
        while ((idx = sseBuffer.indexOf('\n\n')) !== -1) {
          const eventBlock = sseBuffer.slice(0, idx);
          sseBuffer = sseBuffer.slice(idx + 2);
          const dataLines = eventBlock
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.replace(/^data:\s?/, ''));
          for (const data of dataLines) {
            if (!data || data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const choice = json.choices && json.choices[0];
              if (choice && choice.delta && typeof choice.delta.content === 'string') {
                assistantText += choice.delta.content;
              } else if (choice && choice.message && typeof choice.message.content === 'string') {
                assistantText += choice.message.content;
              } else if (typeof json.content === 'string') {
                assistantText += json.content;
              }
            } catch (e) {
              // Non-JSON data line; ignore
            }
          }
        }
      }
    }
    res.end();

    // Persist response payload (best-effort)
    try {
      await query(
        'INSERT INTO chat_logs (session_id, direction, role, content, model, meta) VALUES ($1,$2,$3,$4,$5,$6)',
        [sessionId, 'response', 'assistant', assistantText || null, model, JSON.stringify({ status: orRes.status })]
      );
    } catch (e) {
      console.warn('Failed to persist response log:', e.message);
    }
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

ensureTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend server running on port ${PORT}`);
    });
  })
  .catch((e) => {
    console.error('DB init failed:', e);
    // Still start server to allow health checks; DB endpoints may fail.
    app.listen(PORT, () => {
      console.log(`Backend server running on port ${PORT} (DB init error)`);
    });
  });
