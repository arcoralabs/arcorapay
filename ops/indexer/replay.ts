/**
 * Standalone recovery tool for the arcora-indexer daemon. Two modes:
 *
 *   pnpm tsx replay.ts reset  --to-block <N> --confirm-db-restored
 *     Sets indexer_state.last_processed_block = N. The running daemon picks
 *     this up on its next tick and starts walking from N+1 forward.
 *
 *     ⚠️  Audit Ops-L-13 (2026-05-31): reset ONLY rewinds the cursor. It does
 *     NOT roll back invoice statuses or webhook_attempts. Every replay UPDATE
 *     is status-conditional (`where status='created'` …), so re-walking over
 *     rows that are already in their post-event state updates 0 rows and
 *     still reports success — a silent no-op. reset is therefore ONLY correct
 *     as the second half of restore-the-DB-snapshot-THEN-reset, and the
 *     --confirm-db-restored flag is the explicit ack of that. For ordinary
 *     forward catch-up after downtime, use `replay` (below) — it's idempotent
 *     and never needs a restore.
 *
 *   pnpm tsx replay.ts replay --from <A> --to <B> [--dry-run]
 *     Walks blocks [A, B] in 9k-block chunks, writes any missing paid /
 *     refunded / claimed / recovered rows, and DOES NOT touch indexer_state.
 *     Use this when you want a one-off catch-up without disturbing the
 *     daemon's cursor.
 *
 * The script shares the daemon's RPC + DB env (.env at the same path) and
 * uses the same chunk size + ABI to stay byte-identical with run.ts.
 *
 * Run from /root/arcora-ops/indexer/ on the VPS, or locally after
 * `cd ops/indexer && pnpm install`.
 *
 * Audit 2026-05-24:
 *   - Ops-M3: watch both V10 and (optional) V11 gateways, matching run.ts.
 *     The previous V10-only scan silently dropped V11 events for any
 *     replay covering post-V11-deployment blocks. With V10 retirement
 *     finished, every operational replay now needs V11 coverage.
 *   - Ops-I-3: paid_at / refunded_at / recovered_at / claimed_at now use
 *     the on-chain block timestamp, not the daemon's wall clock. Matches
 *     run.ts so replay-reconstructed rows have the same SLA semantics as
 *     live-processed rows.
 *   - Ops-L-2: each chunk now wraps its DB writes in a transaction.
 *     Partial mid-chunk failures roll back cleanly; the daemon's
 *     own cursor stays put (we don't touch it in replay mode anyway).
 */

import {
  createPublicClient, http, decodeEventLog, parseAbi,
  type Address, type Hex,
} from "viem";
import pg from "pg";
import { buildOpsPoolConfig } from "./db";
import { randomUUID } from "node:crypto";

const RPC = need("ARC_TESTNET_RPC");

// Matches run.ts post-V10-retirement env shape: prefer the bare
// `GATEWAY_ADDRESS`, fall back to legacy `GATEWAY_ADDRESS_V10` for envs
// still mid-migration, optionally additionally watch `GATEWAY_ADDRESS_V11`
// if it's set to a distinct address (the old dual-watch transitional
// shape). Audit 2026-05-24 Ops-M3 + post-retirement env consolidation.
const GATEWAY_PRIMARY = (process.env.GATEWAY_ADDRESS ?? process.env.GATEWAY_ADDRESS_V10 ?? "").toLowerCase();
if (!GATEWAY_PRIMARY) {
  throw new Error("either GATEWAY_ADDRESS (post-retirement) or GATEWAY_ADDRESS_V10 (legacy) must be set");
}
const GATEWAY_V11_RAW = (process.env.GATEWAY_ADDRESS_V11 ?? "").toLowerCase();
// V13 fee-model gateway — same optional dual-watch wiring as V11, matching
// run.ts. Events from this address carry different InvoicePaid semantics
// (see the V13 note on the paid handler below); this var doubles as the
// semantics switch, exactly like run.ts.
const GATEWAY_V13_RAW = (process.env.GATEWAY_ADDRESS_V13 ?? "").toLowerCase();
const WATCHED_GATEWAYS: Address[] = [GATEWAY_PRIMARY as Address];
if (GATEWAY_V11_RAW && GATEWAY_V11_RAW !== GATEWAY_PRIMARY) {
  WATCHED_GATEWAYS.push(GATEWAY_V11_RAW as Address);
}
if (GATEWAY_V13_RAW && GATEWAY_V13_RAW !== GATEWAY_PRIMARY && GATEWAY_V13_RAW !== GATEWAY_V11_RAW) {
  WATCHED_GATEWAYS.push(GATEWAY_V13_RAW as Address);
}
/** Mirrors run.ts: V13 changed InvoicePaid's trailing-arg semantics;
 *  anything not from the V13 address keeps the V10–V12 mapping exactly. */
function isV13Gateway(logAddress: string): boolean {
  return GATEWAY_V13_RAW !== "" && logAddress.toLowerCase() === GATEWAY_V13_RAW;
}
const PG_URL      = need("POSTGRES_URL_NON_POOLING");
const MAX_RANGE   = 9_000n;

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const ABI = parseAbi([
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  // V13 NOTE (see run.ts for the full table): same InvoicePaid signature, but
  // V13 renamed/repurposed the trailing args — grossPayout, invoiceAmountOut,
  // excessToEscrow. The paid handler branches on isV13Gateway(log.address).
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
  "event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash)",
  "event EscrowCreated(bytes32 indexed globalId, address indexed payoutToken, uint256 amount, uint64 claimableAt)",
  "event PayerRefunded(bytes32 indexed globalId, address indexed payer, address payInToken, uint256 amount, bytes32 reasonHash)",
  "event InvoiceRefunded(bytes32 indexed globalId, address indexed refundedTo, address indexed payoutToken, uint256 merchantPayout, uint256 protocolFeeReturned)",
  "event InvoiceClaimed(bytes32 indexed globalId, address indexed merchant, address payoutAddress, address payoutToken, uint256 toMerchant, uint256 fee)",
  "event EscrowRecovered(bytes32 indexed globalId, address indexed merchant, address payoutToken, uint256 amount, address to)",
  "event MerchantReactivated(address indexed merchant)",
]);
const InvoicePaid         = ABI[1];
const EscrowCreated       = ABI[3];
const InvoiceRefunded     = ABI[5];
const InvoiceClaimed      = ABI[6];
const EscrowRecovered     = ABI[7];
const MerchantReactivated = ABI[8];

const chain = createPublicClient({ transport: http(RPC) });
const pool  = new pg.Pool(buildOpsPoolConfig(PG_URL)); // AFG-011: verify-full TLS

/** Audit 2026-05-24 Ops-I-3: cache block timestamps so a chunk with N
 *  events from M unique blocks costs M RPC calls instead of N. */
const blockTsCache = new Map<bigint, number>();
async function blockTsMs(bn: bigint): Promise<number> {
  const hit = blockTsCache.get(bn);
  if (hit !== undefined) return hit;
  const b = await chain.getBlock({ blockNumber: bn });
  const ms = Number(b.timestamp) * 1000;
  blockTsCache.set(bn, ms);
  return ms;
}

async function enqueueWebhook(
  client: pg.PoolClient,
  invoiceId: string,
  merchantId: string,
  eventType: string,
  extra: Record<string, unknown>,
  txHash: string | null,
): Promise<void> {
  const mr = await client.query<{ webhook_url: string | null }>(
    "select webhook_url from merchants where id = $1", [merchantId],
  );
  const url = mr.rows[0]?.webhook_url;
  if (!url) return;
  await client.query(
    `insert into webhook_attempts(invoice_id, url, payload, attempts, next_attempt, event_type)
     values ($1, $2, $3::jsonb, 0, now(), $4)
     on conflict (invoice_id, event_type) do nothing`,
    [
      invoiceId, url,
      JSON.stringify({ event_id: randomUUID(), type: eventType, invoice_id: invoiceId, tx_hash: txHash, replay: true, ...extra }),
      eventType,
    ],
  );
}

interface ReplayCounts {
  scannedChunks:    number;
  paidUpdated:      number;
  refundedUpdated:  number;
  claimedUpdated:   number;
  recoveredUpdated: number;
  webhooksQueued:   number;
}

async function replay(from: bigint, to: bigint, dryRun: boolean): Promise<ReplayCounts> {
  const counts: ReplayCounts = {
    scannedChunks: 0, paidUpdated: 0, refundedUpdated: 0,
    claimedUpdated: 0, recoveredUpdated: 0, webhooksQueued: 0,
  };
  let cursor = from;

  while (cursor <= to) {
    const tentEnd = cursor + MAX_RANGE - 1n;
    const end = tentEnd > to ? to : tentEnd;
    counts.scannedChunks++;
    console.log(`[replay] chunk ${cursor}..${end} gateways=${WATCHED_GATEWAYS.length}`);

    // Audit 2026-05-24 Ops-M3: scan every watched gateway per chunk so V11
    // events aren't silently dropped post-cutover.
    const [
      paidLogs,
      escrowCreatedLogs,
      refundedLogs,
      claimedLogs,
      escrowRecoveredLogs,
      merchantReactivatedLogs,
    ] = await Promise.all([
      chain.getLogs({ address: WATCHED_GATEWAYS, event: InvoicePaid,         fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: EscrowCreated,       fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: InvoiceRefunded,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: InvoiceClaimed,      fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: EscrowRecovered,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: MerchantReactivated, fromBlock: cursor, toBlock: end }),
    ]);

    if (dryRun) {
      console.log(`  [dry] would touch: paid=${paidLogs.length} escrowCreated=${escrowCreatedLogs.length}` +
        ` refunded=${refundedLogs.length} claimed=${claimedLogs.length}` +
        ` recovered=${escrowRecoveredLogs.length} reactivated=${merchantReactivatedLogs.length}`);
      cursor = end + 1n;
      continue;
    }

    // Audit 2026-05-24 Ops-L-2: every chunk's DB writes are bracketed by
    // BEGIN/COMMIT on the same client. A partial mid-chunk failure rolls
    // back cleanly so a re-run picks up exactly where the failed chunk
    // started — no half-applied rows.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const log of paidLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "InvoicePaid") continue;
        const id              = d.args.globalId as Hex;
        const payer           = d.args.payer as string;
        const amountIn        = (d.args.amountIn        as bigint).toString();
        // V13 fee model (parity with run.ts): InvoicePaid's 5th/6th args are
        // invoiceAmountOut / excessToEscrow on V13 — NOT merchantPayout /
        // protocol fee. Settle-time protocol fee is always 0 on V13; the only
        // protocol fee is InvoiceClaimed.fee and merchant_payout is
        // InvoiceClaimed.toMerchant, both written by the claimed handler
        // below. V10–V12 addresses keep the original mapping exactly.
        const v13 = isV13Gateway(log.address);
        const merchantPayout: string | null =
          v13 ? null : (d.args.merchantPayout as bigint).toString();
        const protocolFee     = v13 ? "0" : (d.args.fee as bigint).toString();
        const paidAt          = new Date(await blockTsMs(log.blockNumber)).toISOString();

        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
              set status = 'paid', paid_by = $2, paid_tx = $3, paid_at = $7,
                  amount_in = $4, merchant_payout = $5, protocol_fee = $6
            where id = $1 and status = 'created'
            returning id, merchant_id`,
          [id, payer, log.transactionHash, amountIn, merchantPayout, protocolFee, paidAt],
        );
        if (upd.rowCount && upd.rowCount > 0) {
          counts.paidUpdated++;
          await enqueueWebhook(client, id, upd.rows[0]!.merchant_id, "invoice.paid",
            { paid_by: payer }, log.transactionHash);
          counts.webhooksQueued++;
        }
      }

      // EscrowCreated → set claimable_at.
      // Guard: only update rows still in 'paid' state with no claimable_at set
      // (first sighting wins). On replay, already-claimed/refunded/recovered
      // rows are left untouched, preventing spurious overwrites of terminal state.
      for (const log of escrowCreatedLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "EscrowCreated") continue;
        const id          = d.args.globalId as Hex;
        const claimableAt = d.args.claimableAt as bigint;

        await client.query(
          `update invoices set claimable_at = to_timestamp($2)
             where id = $1 and status = 'paid' and claimable_at is null`,
          [id, Number(claimableAt)],
        );
      }

      for (const log of refundedLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "InvoiceRefunded") continue;
        const id         = d.args.globalId as Hex;
        const refundedTo = d.args.refundedTo as string;
        const refundedAt = new Date(await blockTsMs(log.blockNumber)).toISOString();

        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
              set status = 'refunded', refund_tx = $2, refunded_at = $3
            where id = $1 and status in ('created', 'paid')
            returning id, merchant_id`,
          [id, log.transactionHash, refundedAt],
        );
        if (upd.rowCount && upd.rowCount > 0) {
          counts.refundedUpdated++;
          await enqueueWebhook(client, id, upd.rows[0]!.merchant_id, "invoice.refunded",
            { refunded_to: refundedTo }, log.transactionHash);
          counts.webhooksQueued++;
        }
      }

      // InvoiceClaimed → flip status to 'claimed'
      for (const log of claimedLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "InvoiceClaimed") continue;
        const id         = d.args.globalId as Hex;
        const fee        = (d.args.fee        as bigint).toString();
        const toMerchant = (d.args.toMerchant as bigint).toString();
        const claimedAt  = new Date(await blockTsMs(log.blockNumber)).toISOString();

        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
              set status          = 'claimed',
                  claimed_at      = $5,
                  claim_tx        = $2,
                  protocol_fee    = $3,
                  merchant_payout = $4
            where id = $1 and status = 'paid'
            returning id, merchant_id`,
          [id, log.transactionHash, fee, toMerchant, claimedAt],
        );
        if (upd.rowCount && upd.rowCount > 0) {
          counts.claimedUpdated++;
          await enqueueWebhook(client, id, upd.rows[0]!.merchant_id, "invoice.claimed",
            { fee, to_merchant: toMerchant }, log.transactionHash);
          counts.webhooksQueued++;
        }
      }

      // EscrowRecovered → flip status to 'recovered'
      for (const log of escrowRecoveredLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "EscrowRecovered") continue;
        const id          = d.args.globalId as Hex;
        const recoveredAt = new Date(await blockTsMs(log.blockNumber)).toISOString();

        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
              set status       = 'recovered',
                  recovered_at = $3,
                  recovery_tx  = $2
            where id = $1 and status = 'paid'
            returning id, merchant_id`,
          [id, log.transactionHash, recoveredAt],
        );
        if (upd.rowCount && upd.rowCount > 0) {
          counts.recoveredUpdated++;
          await enqueueWebhook(client, id, upd.rows[0]!.merchant_id, "invoice.recovered",
            {}, log.transactionHash);
          counts.webhooksQueued++;
        }
      }

      // MerchantReactivated → clear deactivated_at.
      // Trade-off: no prior-state guard. On replay, spurious clears are
      // acceptable because the correct on-chain state is the most recent
      // event; if a deactivation replays after this, it will re-set the
      // column and converge to the correct value.
      for (const log of merchantReactivatedLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "MerchantReactivated") continue;
        const merchant = (d.args.merchant as string).toLowerCase();

        await client.query(
          `update merchants set deactivated_at = null where lower(address) = $1`,
          [merchant],
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    cursor = end + 1n;
  }
  return counts;
}

async function reset(toBlock: bigint, opts: { confirmDbRestored: boolean }): Promise<void> {
  // Audit Ops-L-13 (2026-05-31): rewinding the cursor alone does NOT roll back
  // invoice statuses or webhook_attempts; the status-conditional replay UPDATEs
  // become silent no-ops unless the affected rows were first restored to their
  // pre-event state. Refuse without an explicit ack so the only path to a reset
  // is the intended restore-then-reset.
  if (!opts.confirmDbRestored) {
    throw new Error(
      "refusing reset without --confirm-db-restored: a bare cursor rewind re-walks events, but the status-conditional UPDATEs no-op unless the affected rows were first rolled back (restore the DB snapshot, THEN reset). For forward catch-up after downtime use `replay --from <last> --to <head>` — it is idempotent and needs no restore.",
    );
  }
  console.log(`[reset] setting indexer_state.last_processed_block = ${toBlock}`);
  await pool.query(
    `insert into indexer_state(key, value, updated_at)
     values ('last_processed_block', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [toBlock.toString()],
  );
  const head = await chain.getBlockNumber();
  console.log(`[reset] done. Daemon will resume from block ${toBlock + 1n}; chain head is ${head}.`);
}

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.set(key, "true"); // boolean flag
      } else {
        out.set(key, next);
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  const args = parseArgs(rest);

  try {
    if (subcommand === "reset") {
      const block = args.get("to-block");
      if (!block) throw new Error("usage: replay.ts reset --to-block <N> --confirm-db-restored");
      await reset(BigInt(block), { confirmDbRestored: args.has("confirm-db-restored") });
    } else if (subcommand === "replay") {
      const from = args.get("from"), to = args.get("to");
      if (!from || !to) throw new Error("usage: replay.ts replay --from <A> --to <B> [--dry-run]");
      const counts = await replay(BigInt(from), BigInt(to), args.has("dry-run"));
      console.log(JSON.stringify({ msg: "replay.done", ...counts }, null, 2));
    } else {
      console.error("usage:");
      console.error("  replay.ts reset  --to-block <N> --confirm-db-restored");
      console.error("  replay.ts replay --from <A> --to <B> [--dry-run]");
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => {
  console.error("[replay] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
