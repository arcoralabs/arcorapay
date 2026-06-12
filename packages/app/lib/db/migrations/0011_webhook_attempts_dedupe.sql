-- Add event_type column for dedupe. Backfill from existing payload.type.
ALTER TABLE webhook_attempts
  ADD COLUMN IF NOT EXISTS event_type text;

UPDATE webhook_attempts
   SET event_type = payload->>'type'
 WHERE event_type IS NULL;

-- For new rows, event_type must be populated by the writer (indexer).
ALTER TABLE webhook_attempts
  ALTER COLUMN event_type SET NOT NULL;

-- Idempotent webhook insert: same (invoice_id, event_type) on replay → ON CONFLICT DO NOTHING.
-- Lifecycle states (paid, refunded, failed) are mutually exclusive per invoice — at most one
-- webhook of each event_type per invoice is correct. Audit H5 (2026-05-05).
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_attempts_invoice_event_type
  ON webhook_attempts (invoice_id, event_type);
