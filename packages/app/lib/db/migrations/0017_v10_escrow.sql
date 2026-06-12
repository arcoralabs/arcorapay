-- 0017: V10 escrow + reactivate columns + new status values.

-- Add the new enum values to invoice_status. Postgres enums can't drop values
-- non-trivially, so we ADD only.
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'claimed';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'recovered';

-- Per-invoice escrow state
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS claimable_at  timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS claimed_at    timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS claim_tx      text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recovered_at  timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recovery_tx   text;

-- Merchant reactivation tracking — surfaces "deactivated since X" copy
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

-- Index claimable_at to support the "claim all matured" dashboard query
CREATE INDEX IF NOT EXISTS idx_invoices_claimable_at
  ON invoices (claimable_at)
  WHERE status = 'paid' AND claimable_at IS NOT NULL;
