-- ============================================================
-- Order/Payment System - Database Schema
-- Runs automatically on first Postgres container start (docker),
-- or run manually with: psql -U appuser -d appdb -f init.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    customer_name   VARCHAR(120)   NOT NULL,
    product_name    VARCHAR(120)   NOT NULL,
    quantity        INTEGER        NOT NULL CHECK (quantity > 0),
    amount          NUMERIC(10,2)  NOT NULL CHECK (amount >= 0),
    status          VARCHAR(20)    NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
    id              SERIAL PRIMARY KEY,
    order_id        INTEGER        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    amount          NUMERIC(10,2)  NOT NULL,
    status          VARCHAR(20)    NOT NULL DEFAULT 'PENDING',
    provider_ref    VARCHAR(64),
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
