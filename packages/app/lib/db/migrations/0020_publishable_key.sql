-- AFG-019 (2026-06-06): browser-safe publishable key (pk_live_…) per merchant.
-- Stored in plaintext (it is meant to be embedded in client code) and indexed
-- by prefix for O(1) lookup, mirroring api_key_prefix (0010). The secret
-- api_key_hash stays the only credential for privileged routes.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS publishable_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS publishable_key_prefix text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_merchants_publishable_key_prefix
  ON merchants (publishable_key_prefix);
