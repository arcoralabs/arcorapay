import type { Hex } from "viem";
import type { CrosschainState } from "@arcora/crosschain-core";

export interface CrosschainPaymentRow {
  id: string;
  invoice_id: string;
  payer: string;
  source_chain_id: number;
  source_domain: number;
  source_token: string;
  source_amount: string;
  destination_chain_id: number;
  destination_domain: number;
  destination_token: string;
  payout_token: string;
  amount_out_min: string;
  /** Lowercased bytes32 hex (0x + 24 zero bytes + 40 hex chars) the app's
   *  prepare route derived from NEXT_PUBLIC_RELAYER_ADDRESS. The CCTP
   *  receive accepts a mint to this address as well as the env-derived
   *  relayer address (env-skew self-healing). */
  mint_recipient: string;
  status: CrosschainState;
  burn_tx_hash: string | null;
  /** When the source-chain burn was submitted. claimNextCrosschain does
   *  `returning *` so the column arrives on claimed rows (pg returns Date).
   *  The worker uses it as the wall-clock bound on attestation polling. */
  burn_submitted_at: Date | string | null;
  cctp_message: string | null;
  cctp_attestation: string | null;
  bridge_receive_tx_hash: string | null;
  bridge_amount_received: string | null;
  arc_swap_tx_hash: string | null;
  arc_swap_amount_out: string | null;
  settle_tx_hash: string | null;
  /** Optional: present on rows claimed from the DB (select *). The run.ts
   *  refund wiring uses it to resume a crashed refund instead of
   *  re-broadcasting the customer transfer (double-refund guard). */
  refund_tx_hash?: string | null;
  attempts: number;
  last_error: string | null;
  /** Optional: present on rows claimed from the DB (`returning *`; both
   *  columns are NOT NULL DEFAULT now() in migration 0021). Fallback anchors
   *  for the attestation deadline when burn_submitted_at was never persisted
   *  (crash before the burn checkpoint) — audit MED-3. */
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

export interface CrosschainWorkerDeps {
  fetchAttestation(row: CrosschainPaymentRow): Promise<{ message: Hex; attestation: Hex } | null>;
  receiveMessage(
    row: CrosschainPaymentRow,
    attestation: { message: Hex; attestation: Hex },
    onBroadcast: (txHash: Hex) => Promise<void>,
  ): Promise<{ txHash: Hex; amountReceived: bigint }>;
  swapOnArc(row: CrosschainPaymentRow): Promise<{ amountOut: bigint; txHash: Hex }>;
  settleOnArc(args: {
    row: CrosschainPaymentRow;
    grossPayout: bigint;
    swapTxHash: Hex;
  }): Promise<Hex>;
  refundOnArc(args: {
    row: CrosschainPaymentRow;
    token: string;
    amount: bigint;
  }): Promise<Hex>;
  /** Persist a partial row update. `releaseLease: false` keeps the claim
   *  lease held — used for mid-flight persists (broadcast-hash checkpoints)
   *  so the row isn't reclaimable while a receipt wait is in progress.
   *  Defaults to releasing the lease (terminal/scheduling transitions). */
  mark(id: string, values: Record<string, unknown>, opts?: { releaseLease?: boolean }): Promise<void>;
  fail(id: string, status: CrosschainState, error: string): Promise<void>;
  /** Wall-clock bound on attestation polling, measured from
   *  burn_submitted_at. Defaults to 2 hours (7_200_000 ms) when absent. */
  attestationDeadlineMs?: number;
}
