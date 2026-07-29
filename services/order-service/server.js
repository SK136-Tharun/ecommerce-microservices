require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const pino = require('pino');
const pinoHttp = require('pino-http');
const pool = require('./db');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();

const PORT = process.env.PORT || 4001;
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4002';
const SERVICE_NAME = 'order-service';

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

// --- Health check (used by Docker/systemd/pm2/nginx) ---
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: SERVICE_NAME, db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', service: SERVICE_NAME, db: 'disconnected' });
  }
});

// --- Create an order, then trigger payment ---
app.post('/api/orders', async (req, res) => {
  const { customerName, productName, quantity, amount } = req.body;

  if (!customerName || !productName || !quantity || amount == null) {
    return res.status(400).json({ error: 'customerName, productName, quantity, amount are required' });
  }

  const client = await pool.connect();
  try {
    const insertResult = await client.query(
      `INSERT INTO orders (customer_name, product_name, quantity, amount, status)
       VALUES ($1, $2, $3, $4, 'PENDING') RETURNING *`,
      [customerName, productName, quantity, amount]
    );
    const order = insertResult.rows[0];
    req.log.info({ orderId: order.id }, 'order created, calling payment-service');

    // Call payment-service to process payment for this order.
    // Failure here does not fail order creation — order stays PENDING
    // and can be retried; this keeps the two services loosely coupled.
    try {
      const paymentRes = await axios.post(
        `${PAYMENT_SERVICE_URL}/api/payments`,
        { orderId: order.id, amount: order.amount },
        { timeout: 5000 }
      );
      order.paymentStatus = paymentRes.data.status;
    } catch (paymentErr) {
      req.log.error({ err: paymentErr.message }, 'payment-service call failed');
      order.paymentStatus = 'PAYMENT_SERVICE_UNAVAILABLE';
    }

    res.status(201).json(order);
  } catch (err) {
    req.log.error(err, 'failed to create order');
    res.status(500).json({ error: 'internal server error' });
  } finally {
    client.release();
  }
});

// --- List orders ---
app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY id DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    req.log.error(err, 'failed to list orders');
    res.status(500).json({ error: 'internal server error' });
  }
});

// --- Get single order ---
app.get('/api/orders/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'order not found' });
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error(err, 'failed to fetch order');
    res.status(500).json({ error: 'internal server error' });
  }
});

// --- Called BACK by payment-service once a payment is processed ---
app.patch('/api/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  const allowed = ['PENDING', 'PAID', 'PAYMENT_FAILED', 'CANCELLED'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
  }
  try {
    const result = await pool.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'order not found' });
    req.log.info({ orderId: req.params.id, status }, 'order status updated');
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error(err, 'failed to update order status');
    res.status(500).json({ error: 'internal server error' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

const server = app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
});

// --- Graceful shutdown (important for systemd/pm2/docker restarts) ---
function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
