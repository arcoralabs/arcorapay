-- 0019: rate_limit_counters cleanup index (audit App-L-8, 2026-05-31).
-- The daily siwe-nonce-cleanup cron deletes rate_limit_counters
-- WHERE window_start < now() - interval '1 hour'. Without this index that
-- DELETE full-scans the table — which every per-IP limiter (siwe-nonce,
-- quote, quote-v06, authorize, submit, invoices) writes to, not just SIWE.
CREATE INDEX IF NOT EXISTS "idx_rate_limit_counters_window_start"
  ON "rate_limit_counters" ("window_start");
