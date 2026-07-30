require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:4001';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4002';
const DEPLOY_MODE = process.env.DEPLOY_MODE || 'unknown';

app.use(helmet({ contentSecurityPolicy: false }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'frontend', mode: DEPLOY_MODE, port: PORT }));

// The dashboard's JS only ever talks to same-origin "api/..." paths
// (relative, no leading slash), so it works whether this frontend is
// reached directly, behind nginx at "/", or behind nginx at a sub-path
// like "/systemd/" or "/pm2/" -- the browser resolves relative URLs
// against whatever path the page itself was loaded from.
//
// pathFilter (not the app.use mount path) does the route matching here --
// mounting with app.use('/api/orders', proxy) strips that prefix from
// req.url before the proxy ever sees it, so order-service would receive
// "/" instead of "/api/orders" and 404. pathFilter preserves the full path.
app.use(createProxyMiddleware({ target: ORDER_SERVICE_URL, changeOrigin: true, pathFilter: '/api/orders' }));
app.use(createProxyMiddleware({ target: PAYMENT_SERVICE_URL, changeOrigin: true, pathFilter: '/api/payments' }));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`dashboard-frontend [${DEPLOY_MODE}] listening on port ${PORT}`);
  console.log(`-> proxying /api/orders   to ${ORDER_SERVICE_URL}`);
  console.log(`-> proxying /api/payments to ${PAYMENT_SERVICE_URL}`);
});
