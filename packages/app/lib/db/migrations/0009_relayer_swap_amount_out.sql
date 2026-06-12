-- 0009 — record exact swap amountOut alongside swap_tx_hash so the
-- stage-aware resume path uses the real gross payout instead of the
-- merchant-floor approximation. Without this, swap surplus accumulates
-- silently in the relayer hot wallet on every reclaimed-after-swap row.
-- Audit residual P2 (2026-05-05).

ALTER TABLE "relayer_queue"
  ADD COLUMN IF NOT EXISTS "swap_amount_out" numeric;
