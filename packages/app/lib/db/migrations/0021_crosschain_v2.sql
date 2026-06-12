DO $$ BEGIN
  CREATE TYPE crosschain_payment_status AS ENUM (
    'created',
    'authorized',
    'bridge_pending',
    'bridge_confirmed',
    'arc_swap_pending',
    'settle_pending',
    'paid',
    'bridge_failed',
    'arc_swap_failed',
    'settle_failed',
    'refunded',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE settlement_tier AS ENUM ('zero_day', 'one_day', 'seven_day');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS settlement_tier settlement_tier NOT NULL DEFAULT 'seven_day',
  ADD COLUMN IF NOT EXISTS settlement_policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS crosschain_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  payer text NOT NULL,
  source_chain_id integer NOT NULL,
  source_domain integer NOT NULL,
  source_token text NOT NULL,
  source_amount numeric NOT NULL,
  destination_chain_id integer NOT NULL,
  destination_domain integer NOT NULL,
  destination_token text NOT NULL,
  mint_recipient text NOT NULL,
  payout_token text NOT NULL,
  amount_out_min numeric NOT NULL,
  route_version text NOT NULL,
  status crosschain_payment_status NOT NULL DEFAULT 'created',
  burn_tx_hash text,
  burn_submitted_at timestamptz,
  cctp_message text,
  cctp_attestation text,
  bridge_receive_tx_hash text,
  bridge_amount_received numeric,
  bridge_confirmed_at timestamptz,
  arc_swap_tx_hash text,
  arc_swap_amount_out numeric,
  settle_tx_hash text,
  refund_tx_hash text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_id),
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_crosschain_payments_status_next_attempt
  ON crosschain_payments(status, next_attempt);

CREATE INDEX IF NOT EXISTS idx_crosschain_payments_invoice
  ON crosschain_payments(invoice_id);

-- Unique: one on-chain burn tx can satisfy at most one intent. CCTP
-- receiveMessage is replay-protected, so a second intent claiming the same
-- burn could never be settled by the relayer. An earlier in-flight revision
-- of this migration created a plain index under the old name; drop it so
-- every environment converges on the unique form.
DROP INDEX IF EXISTS idx_crosschain_payments_burn_tx;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_crosschain_payments_burn_tx
  ON crosschain_payments(source_chain_id, burn_tx_hash)
  WHERE burn_tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkout_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text REFERENCES invoices(id) ON DELETE CASCADE,
  crosschain_payment_id uuid REFERENCES crosschain_payments(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  source_chain_id integer,
  elapsed_ms integer,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkout_telemetry_invoice_created
  ON checkout_telemetry(invoice_id, created_at);

CREATE INDEX IF NOT EXISTS idx_checkout_telemetry_event_created
  ON checkout_telemetry(event_type, created_at);
