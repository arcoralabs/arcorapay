-- Audit M5 (2026-05-06): add terminal_reason column to webhook_attempts.
-- When a 4xx response causes permanent termination, the daemon sets
-- terminal_reason to a short code (e.g. "http_404") and next_attempt to NULL.
-- fetchDue filters WHERE terminal_reason IS NULL so these rows are never
-- re-queued. NULL means still retryable.
ALTER TABLE webhook_attempts ADD COLUMN IF NOT EXISTS terminal_reason text;
