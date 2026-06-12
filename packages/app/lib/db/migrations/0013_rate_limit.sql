-- 0013 — fixed-window rate limit counters (audit M9, 2026-05-06)
--
-- Used by /api/auth/siwe/nonce to bound nonce-issuance per IP. Generic
-- shape so other endpoints can reuse it (key by route+ip+window). Cleanup
-- happens via the daily SIWE-cleanup cron (also in M9).
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
