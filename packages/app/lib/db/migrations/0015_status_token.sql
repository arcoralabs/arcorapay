-- 0015 — invoices.status_token + status_token_expires_at  (audit M12, 2026-05-06)
--
-- /api/checkout/submit returns a 30-min status_token in its response. The
-- status polling endpoint (/api/checkout/status/[id]) checks for a matching
-- token; without one, the route returns ONLY { status }, no error string,
-- no tx hashes, no merchant-internal details. Closes the public-detail leak
-- where any submission UUID could be probed for failure modes / settle
-- evidence.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status_token text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status_token_expires_at timestamptz;
