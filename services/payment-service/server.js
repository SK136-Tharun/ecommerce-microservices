require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const crypto = require('crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');
const pool = require('./db');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();

const PORT = process.env.PORT || 4002;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:4001';
const SERVICE_NAME = 'payment-service';

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: SERVICE_NAME, db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', service: SERVICE_NAME, db: 'disconnected' });
  }
});

// --- Process a payment for an order ---
app.post('/api/payments', async (req, res) => {
  const { orderId, amount } = req.body;
  if (!orderId || amount == null) {
    return res.status(400).json({ error: 'orderId and amount are required' });
  }

  // Simulate a payment gateway call (90% success rate, deterministic latency)
  const succeeded = Math.random() < 0.9;
  const providerRef = crypto.randomUUID();
  const status = succeeded ? 'SUCCESS' : 'FAILED';

  const client = await pool.connect();
  try {
    const insertResult = await client.query(
      `INSERT INTO payments (order_id, amount, status, provider_ref)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [orderId, amount, status, providerRef]
    );
    const payment = insertResult.rows[0];
    req.log.info({ paymentId: payment.id, orderId, status }, 'payment processed');

    // Report result back to order-service so it can update order status.
    // This is the "communicating with each other" link between the two services.
    try {
      await axios.patch(
        `${ORDER_SERVICE_URL}/api/orders/${orderId}/status`,
        { status: succeeded ? 'PAID' : 'PAYMENT_FAILED' },
        { timeout: 5000 }
      );
    } catch (callbackErr) {
      req.log.error({ err: callbackErr.message }, 'failed to notify order-service of payment result');
    }

    res.status(201).json(payment);
  } catch (err) {
    req.log.error(err, 'failed to process payment');
    res.status(500).json({ error: 'internal server error' });
  } finally {
    client.release();
  }
});

// --- List payments ---
app.get('/api/payments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments ORDER BY id DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    req.log.error(err, 'failed to list payments');
    res.status(500).json({ error: 'internal server error' });
  }
});

// --- Payments for a specific order ---
app.get('/api/payments/order/:orderId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payments WHERE order_id = $1 ORDER BY id DESC', [req.params.orderId]);
    res.json(result.rows);
  } catch (err) {
    req.log.error(err, 'failed to fetch payments for order');
    res.status(500).json({ error: 'internal server error' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

const server = app.listen(PORT, () => {
  logger.info(`${SERVICE_NAME} listening on port ${PORT}`);
});

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
