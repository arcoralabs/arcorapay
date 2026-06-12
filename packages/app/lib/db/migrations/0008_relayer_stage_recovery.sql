-- 0008 — relayer stage-aware recovery (audit pass 2, finding #3)
--
-- Adds permit2_tx_hash so the relayer can detect mid-flight crashes after
-- the Permit2 pull but before settle, and resume from the next pending
-- stage instead of replaying step 1 (which would now revert with
-- InvalidNonce since the on-chain Permit2 nonce is consumed). swap_tx_hash,
-- settle_tx_hash, and refund_tx_hash already exist; this column was the
-- only gap.

ALTER TABLE "relayer_queue"
  ADD COLUMN IF NOT EXISTS "permit2_tx_hash" text;
