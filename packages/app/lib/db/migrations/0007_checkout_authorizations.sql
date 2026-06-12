-- 0007 — submit pre-flight hardening (audit pass 1)
--
-- Two changes in one migration so they ship as one logical unit:
--
-- 1. checkout_authorizations: short-lived row written on /api/checkout/authorize
--    when compliance returns `allow`. Bound to (invoice_id, payer); carries
--    the minimum amountIn the customer is allowed to commit. /api/checkout/submit
--    requires + consumes one of these before queueing the Permit2 message,
--    closing the bypass where a blocked wallet could skip the React-side
--    authorize call and POST to submit directly.
--
-- 2. uniq_relayer_queue_active_invoice: partial unique index on relayer_queue
--    over (invoice_id) for currently-active rows. Today's submit does a
--    select-then-insert which is raceable; with this index, two concurrent
--    submits for the same invoice both lose to a unique-constraint violation
--    on one side, so the relayer never pulls/swaps twice.

CREATE TABLE IF NOT EXISTS "checkout_authorizations" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id"    text NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "payer"         text NOT NULL,                              -- lowercase 0x...
  "pay_in_token"  text NOT NULL,                              -- lowercase 0x...
  "min_amount_in" numeric NOT NULL,                           -- base units, customer must commit >=
  "expires_at"    timestamp with time zone NOT NULL,
  "consumed_at"   timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now()
);

-- Lookup: /api/checkout/submit fetches the latest unconsumed, unexpired auth
-- for (invoice_id, payer). The partial index keeps it cheap as the table grows.
CREATE INDEX IF NOT EXISTS "idx_checkout_auth_active"
  ON "checkout_authorizations" ("invoice_id", "payer")
  WHERE "consumed_at" IS NULL;

-- Idempotency lane on the relayer queue.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_relayer_queue_active_invoice"
  ON "relayer_queue" ("invoice_id")
  WHERE status IN ('pending','processing','settled');
