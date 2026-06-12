-- 0018: retention index hygiene (audit DB hygiene gap, 2026-05-12).
-- Cron jobs prune both tables WHERE expires_at < now(); without these
-- indexes the cleanup job full-scans the table on every tick.
CREATE INDEX IF NOT EXISTS "idx_siwe_nonces_expires_at"
  ON "siwe_nonces" ("expires_at");

CREATE INDEX IF NOT EXISTS "idx_compliance_screenings_expires_at"
  ON "compliance_screenings" ("expires_at");
