ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS api_key_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS allowed_origins text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_merchants_api_key_prefix
  ON merchants (api_key_prefix);
