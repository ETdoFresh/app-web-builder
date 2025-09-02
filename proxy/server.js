const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_URL = 'http://localhost:3001';

app.use('/api', createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  onError: (err, req, res) => {
    console.error('Backend proxy error:', err);
    res.status(502).json({ error: 'Backend service unavailable' });
  }
}));

app.use('/', createProxyMiddleware({
  target: FRONTEND_URL,
  changeOrigin: true,
  ws: true,
  onError: (err, req, res) => {
    console.error('Frontend proxy error:', err);
    res.status(502).send('Frontend service unavailable');
  }
}));

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
  console.log(`Proxying /api/* requests to ${BACKEND_URL}`);
  console.log(`Proxying all other requests to ${FRONTEND_URL}`);
});
