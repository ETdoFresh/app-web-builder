const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
// Support PROXY_PORT to avoid clashing with backend's PORT when using a single root .env
const PORT = Number(process.env.PROXY_PORT || process.env.PORT || 3000);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Trust proxy headers when running behind HTTPS terminators (e.g., tunnels/CDN)
app.set('trust proxy', true);

// Normalize chat routes so they always land on the HTML entry
app.get(['/chat', '/chat/'], (req, res) => {
  res.redirect(301, '/chat/index.html');
});

// --- Backend API proxy ---
const apiProxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  onError: (err, req, res) => {
    console.error('Backend proxy error:', err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Backend service unavailable' });
    }
  }
});
app.use('/api', apiProxy);

// --- Frontend + Vite dev server (HTTP + WebSocket/HMR) ---
const feProxy = createProxyMiddleware({
  target: FRONTEND_URL,
  changeOrigin: true,
  ws: true, // enable WS proxying
  onError: (err, req, res) => {
    console.error('Frontend proxy error:', err);
    if (!res.headersSent) {
      res.status(502).send('Frontend service unavailable');
    }
  }
});
app.use('/', feProxy);

// Create explicit HTTP server so we can hook WebSocket upgrades
const server = http.createServer(app);

// Forward all WS upgrades to the frontend proxy (Vite HMR, etc.)
server.on('upgrade', (req, socket, head) => {
  try {
    console.log('Proxy WS upgrade:', req.url);
    feProxy.upgrade?.(req, socket, head);
  } catch (err) {
    console.error('WS upgrade error:', err);
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
  console.log(`Proxying /api/* requests to ${BACKEND_URL}`);
  console.log(`Proxying all other requests (incl. HMR WS) to ${FRONTEND_URL}`);
});
