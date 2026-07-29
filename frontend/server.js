require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:4001';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4002';

app.use(helmet({ contentSecurityPolicy: false }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'frontend' }));

// The dashboard's JS only ever talks to same-origin "/api/..." paths.
// This frontend acts as a lightweight gateway so it works standalone,
// behind nginx, in Docker, via PM2, or via systemd without any change
// to client-side code.
app.use('/api/orders', createProxyMiddleware({ target: ORDER_SERVICE_URL, changeOrigin: true }));
app.use('/api/payments', createProxyMiddleware({ target: PAYMENT_SERVICE_URL, changeOrigin: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`dashboard-frontend listening on port ${PORT}`);
  console.log(`-> proxying /api/orders   to ${ORDER_SERVICE_URL}`);
  console.log(`-> proxying /api/payments to ${PAYMENT_SERVICE_URL}`);
});
