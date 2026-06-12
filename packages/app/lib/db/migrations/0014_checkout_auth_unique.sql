-- 0014 — checkout_authorizations: UNIQUE partial index on (invoice_id, payer)
-- WHERE consumed_at IS NULL  (audit M10, 2026-05-06)
--
-- Migration 0007 created this as a non-unique partial index, which makes the
-- /api/checkout/authorize INSERT raceable: two concurrent requests from the
-- same payer for the same invoice can both successfully insert, so the
-- subsequent /api/checkout/submit may consume the wrong row (potentially
-- with a different min_amount_in). Promoting to UNIQUE moves dedupe to the
-- DB; the route catches 23505 and returns the existing row idempotently.
DROP INDEX IF EXISTS idx_checkout_auth_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_auth_active
  ON checkout_authorizations (invoice_id, payer)
  WHERE consumed_at IS NULL;
