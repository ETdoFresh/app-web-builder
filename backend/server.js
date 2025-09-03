const path = require('path');
const crypto = require('crypto');
// Load env from repo root first, then backend/.env (if present)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
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

// --- Chat Logs API ---
// List chat sessions with counts and last activity
app.get('/api/v1/chat/sessions', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '50', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    const result = await query(
      `WITH agg AS (
         SELECT session_id,
                COUNT(*) AS count,
                MIN(created_at) AS first_activity,
                MAX(created_at) AS last_activity
           FROM chat_logs
          WHERE session_id IS NOT NULL AND session_id <> ''
          GROUP BY session_id
      )
      SELECT * FROM agg
      ORDER BY last_activity DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Total sessions count for pagination (best effort)
    const totalRes = await query(
      `SELECT COUNT(DISTINCT session_id) AS total
         FROM chat_logs
        WHERE session_id IS NOT NULL AND session_id <> ''`
    );
    res.json({
      ok: true,
      total: Number(totalRes.rows?.[0]?.total || 0),
      sessions: result.rows.map(r => ({
        session_id: r.session_id,
        count: Number(r.count || 0),
        first_activity: r.first_activity,
        last_activity: r.last_activity,
      }))
    });
  } catch (err) {
    const detail = (err && err.message) ? err.message : String(err);
    console.error('List sessions failed:', detail);
    res.status(500).json({ ok: false, error: detail });
  }
});

// List chat logs; optional filter by session_id; supports ordering and pagination
app.get('/api/v1/chat/logs', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '200', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const sessionId = req.query.session_id;

    let sql = `SELECT id, session_id, direction, role, content, model, meta, created_at
                 FROM chat_logs`;
    const params = [];
    if (sessionId) {
      params.push(sessionId);
      sql += ` WHERE session_id = $${params.length}`;
    }
    sql += ` ORDER BY created_at ${order} NULLS LAST, id ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    res.json({ ok: true, logs: result.rows });
  } catch (err) {
    const detail = (err && err.message) ? err.message : String(err);
    console.error('List logs failed:', detail);
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
  let clientAborted = false;
  let finished = false;
  // Detect early client abort while uploading request
  req.on('aborted', () => { clientAborted = true; try { controller.abort(); } catch {} });
  // Detect client disconnect on the response stream (SSE)
  res.on('close', () => { if (!finished) { clientAborted = true; try { controller.abort(); } catch {} } });
  const debugEnabled = (() => {
    const v = String(req.query?.debug || req.headers['x-debug'] || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  })();

  // Sanitize messages: drop empty assistant placeholders and non-string contents
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages.filter(m => {
    if (!m) return false;
    const role = m.role;
    const content = m.content;
    if (role === 'assistant' && (content == null || String(content).trim() === '')) return false;
    return typeof content === 'string';
  });

  const upstreamBody = {
    ...body,
    messages,
    model,
    stream: true,
  };

  // Prepare SSE headers (per OpenRouter streaming guidance)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable proxy buffering for SSE (e.g., nginx)
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  // Periodic comment pings keep intermediaries from timing out idle streams
  const keepAlive = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch {}
  }, 15000);

  try {
    // Compute Referer before any debug usage
    const siteUrlEnv = process.env.OPENROUTER_SITE || process.env.OPENROUTER_SITE_URL;
    const referer = siteUrlEnv || req.headers['origin'] || req.headers['referer'] || 'http://localhost:3000';

    // If debugging, emit a pre-flight debug frame with the outbound payload (sanitized)
    if (debugEnabled) {
      const dbg = {
        type: 'request',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        model,
        message_count: Array.isArray(upstreamBody.messages) ? upstreamBody.messages.length : 0,
        messages: upstreamBody.messages,
        referer,
        reasoning: upstreamBody.reasoning || null,
      };
      res.write(`event: debug\n`);
      res.write(`data: ${JSON.stringify(dbg)}\n\n`);
    }
    // Persist request payload (best-effort)
    try {
      const userContents = Array.isArray(rawMessages)
        ? rawMessages.filter(m => m && m.role === 'user' && typeof m.content === 'string').map(m => m.content).join('\n\n')
        : null;
      await query(
        'INSERT INTO chat_logs (session_id, direction, role, content, model, meta) VALUES ($1,$2,$3,$4,$5,$6)',
        [sessionId, 'request', null, userContents, model, JSON.stringify(body)]
      );
    } catch (e) {
      console.warn('Failed to persist request log:', e.message);
    }
    // Call OpenRouter
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
      if (debugEnabled) {
        const dbg = { type: 'response_error', status: orRes.status, statusText: orRes.statusText, body: text?.slice(0, 4000) };
        res.write(`event: debug\n`);
        res.write(`data: ${JSON.stringify(dbg)}\n\n`);
      }
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
    if (debugEnabled) {
      const dbg = { type: 'response_summary', status: orRes.status, assistant_chars: assistantText.length };
      res.write(`event: debug\n`);
      res.write(`data: ${JSON.stringify(dbg)}\n\n`);
    }
    finished = true;
    try { clearInterval(keepAlive); } catch {}
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
    const isAbort = err && err.name === 'AbortError';
    const msg = isAbort && clientAborted ? 'client_disconnected' : (err && err.message) ? err.message : String(err);
    if (!res.headersSent) {
      try { res.status(500).json({ error: msg }); } catch {}
      return;
    }
    if (!res.writableEnded) {
      try { res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); } catch {}
      try { clearInterval(keepAlive); } catch {}
      try { res.end(); } catch {}
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
