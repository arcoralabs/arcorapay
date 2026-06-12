import {
  createPublicClient, http, decodeEventLog, parseAbi,
  type Address, type Hex,
} from "viem";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { buildOpsPoolConfig, describeDbTls, assertSecureDbTls } from "./db";

const RPC = need("ARC_TESTNET_RPC");

// Post-V10 retirement (2026-05-20): production .env files use the bare
// `GATEWAY_ADDRESS` key. We still accept the legacy `GATEWAY_ADDRESS_V10`
// + optional `GATEWAY_ADDRESS_V11` pair for backward compat with any env
// that hasn't been migrated yet — at most one path will be populated in
// practice, and either way we end up with `WATCHED_GATEWAYS` listing
// every distinct gateway address.
const GATEWAY_PRIMARY = (process.env.GATEWAY_ADDRESS ?? process.env.GATEWAY_ADDRESS_V10 ?? "").toLowerCase();
if (!GATEWAY_PRIMARY) {
  throw new Error("either GATEWAY_ADDRESS (post-retirement) or GATEWAY_ADDRESS_V10 (legacy) must be set");
}
const GATEWAY_V11_RAW = (process.env.GATEWAY_ADDRESS_V11 ?? "").toLowerCase();
// V13 fee-model gateway (2026-06-11 redeploy). Same optional dual-watch
// wiring as V11, but events from this address carry DIFFERENT InvoicePaid
// semantics — see the V13 note on the InvoicePaid handler below. This var
// is also the semantics switch: if a future env consolidates V13 into the
// bare GATEWAY_ADDRESS, keep GATEWAY_ADDRESS_V13 set (to the same value)
// so the handler still recognizes the address as V13.
const GATEWAY_V13_RAW = (process.env.GATEWAY_ADDRESS_V13 ?? "").toLowerCase();
// De-dup: if a versioned var is set to the same value as the primary
// (some envs do this defensively during a cutover), don't list the
// address twice in WATCHED_GATEWAYS — getLogs would double-emit.
const WATCHED_GATEWAYS: Address[] = [GATEWAY_PRIMARY as Address];
if (GATEWAY_V11_RAW && GATEWAY_V11_RAW !== GATEWAY_PRIMARY) {
  WATCHED_GATEWAYS.push(GATEWAY_V11_RAW as Address);
}
if (GATEWAY_V13_RAW && GATEWAY_V13_RAW !== GATEWAY_PRIMARY && GATEWAY_V13_RAW !== GATEWAY_V11_RAW) {
  WATCHED_GATEWAYS.push(GATEWAY_V13_RAW as Address);
}
/** V13 changed InvoicePaid's trailing args (see handler note); everything
 *  not from the V13 address keeps the V10–V12 mapping exactly. */
function isV13Gateway(logAddress: string): boolean {
  return GATEWAY_V13_RAW !== "" && logAddress.toLowerCase() === GATEWAY_V13_RAW;
}
// Kept as a stable alias for the start-line log so dashboards/alerts that
// grep for `gateway:0x…` keep matching. Points at the same primary
// address the rest of the daemon reads.
const GATEWAY_V10 = GATEWAY_PRIMARY as Address;
const PG_URL       = need("POSTGRES_URL_NON_POOLING");
const REORG_BUFFER = BigInt(process.env.INDEXER_REORG_BUFFER_BLOCKS ?? "5");
const TICK_MS      = Number(process.env.INDEXER_TICK_MS ?? "30000");
const MAX_RANGE    = 9_000n; // Arc testnet eth_getLogs cap

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const ABI = parseAbi([
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  // V13 NOTE: the InvoicePaid ABI signature (types/topic0) is unchanged, but
  // V13 renamed the trailing params and changed their semantics:
  //   grossReceived  → grossPayout      (full gross routed to escrow)
  //   merchantPayout → invoiceAmountOut (the invoice's amountOut, NOT a payout)
  //   fee            → excessToEscrow   (merchant money, NOT protocol revenue)
  // We keep the V10–V12 names here; the InvoicePaid handler branches on the
  // emitting address (isV13Gateway) to map the args correctly per version.
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
  "event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash)",
  "event EscrowCreated(bytes32 indexed globalId, address indexed payoutToken, uint256 amount, uint64 claimableAt)",
  "event PayerRefunded(bytes32 indexed globalId, address indexed payer, address payInToken, uint256 amount, bytes32 reasonHash)",
  "event InvoiceRefunded(bytes32 indexed globalId, address indexed refundedTo, address indexed payoutToken, uint256 merchantPayout, uint256 protocolFeeReturned)",
  "event InvoiceClaimed(bytes32 indexed globalId, address indexed merchant, address payoutAddress, address payoutToken, uint256 toMerchant, uint256 fee)",
  "event EscrowRecovered(bytes32 indexed globalId, address indexed merchant, address payoutToken, uint256 amount, address to)",
  "event MerchantReactivated(address indexed merchant)",
]);
const InvoiceCreated     = ABI[0];
const InvoicePaid        = ABI[1];
const SettlementContext  = ABI[2];
const EscrowCreated      = ABI[3];
const PayerRefunded      = ABI[4];
const InvoiceRefunded    = ABI[5];
const InvoiceClaimed     = ABI[6];
const EscrowRecovered    = ABI[7];
const MerchantReactivated = ABI[8];

const chain = createPublicClient({ transport: http(RPC) });
// AFG-011: verify-full TLS (pinned Supabase CA) — no disabled cert checks.
const _poolCfg = buildOpsPoolConfig(PG_URL);
assertSecureDbTls(_poolCfg);
console.log(`[indexer] DB TLS: ${describeDbTls(_poolCfg)}`);
const pool  = new pg.Pool(_poolCfg);

async function getLastBlock(): Promise<bigint> {
  const r = await pool.query<{ value: string }>(
    "select value from indexer_state where key = 'last_processed_block' limit 1",
  );
  return r.rows[0] ? BigInt(r.rows[0].value) : 0n;
}

// Audit MED-4 (2026-06-11): takes the chunk's transaction client so the
// cursor advance commits atomically with the chunk's row writes — it is
// the FINAL statement inside the per-chunk transaction in tick().
// pg.Pool and pg.PoolClient share the .query interface.
async function setLastBlock(db: pg.Pool | pg.PoolClient, v: bigint): Promise<void> {
  await db.query(
    `insert into indexer_state(key, value, updated_at)
     values ('last_processed_block', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [v.toString()],
  );
}

// Audit MED-4 (2026-06-11): runs on the chunk's transaction client, not the
// pool, so a webhook enqueue can't outlive a rolled-back invoice update.
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
      JSON.stringify({ event_id: randomUUID(), type: eventType, invoice_id: invoiceId, tx_hash: txHash, ...extra }),
      eventType,
    ],
  );
}

async function tick(): Promise<{
  from: bigint; to: bigint; created: number; backfilled: number; paid: number;
  refunded: number; failed: number; claimed: number; recovered: number; chunks: number;
}> {
  const last = await getLastBlock();
  const head = await chain.getBlockNumber();
  const to   = head - REORG_BUFFER;
  let cursor = last + 1n;
  let created = 0, backfilled = 0, paid = 0, refunded = 0, failed = 0, claimed = 0, recovered = 0, chunks = 0;

  // Per-tick block timestamp cache. Audit #36 — failed_at and related event
  // times need to be the *block* time, not the daemon's wall-clock, so a
  // catch-up replay populates refund SLAs that match what really happened
  // on-chain. Most events in a tick cluster on a few unique blocks, so this
  // shrinks N RPC calls to ~unique-blocks-per-tick.
  const blockTsCache = new Map<bigint, number>();
  async function blockTsMs(bn: bigint): Promise<number> {
    const hit = blockTsCache.get(bn);
    if (hit !== undefined) return hit;
    const b = await chain.getBlock({ blockNumber: bn });
    const ms = Number(b.timestamp) * 1000;
    blockTsCache.set(bn, ms);
    return ms;
  }

  while (cursor <= to) {
    const tentEnd = cursor + MAX_RANGE - 1n;
    const end = tentEnd > to ? to : tentEnd;

    const [
      createdLogs,
      paidLogs,
      settleCtxLogs,
      escrowCreatedLogs,
      payerRefundedLogs,
      refundedLogs,
      claimedLogs,
      escrowRecoveredLogs,
      merchantReactivatedLogs,
    ] = await Promise.all([
      chain.getLogs({ address: WATCHED_GATEWAYS, event: InvoiceCreated,      fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: InvoicePaid,         fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: SettlementContext,   fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: EscrowCreated,       fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: PayerRefunded,       fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: InvoiceRefunded,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: InvoiceClaimed,      fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: EscrowRecovered,     fromBlock: cursor, toBlock: end }),
      chain.getLogs({ address: WATCHED_GATEWAYS, event: MerchantReactivated, fromBlock: cursor, toBlock: end }),
    ]);

    // Index SettlementContext by globalId so we can stitch payInToken +
    // swapTxHash onto the InvoicePaid row in the same chunk. V10 emits
    // both in the same tx; if they ever land in adjacent chunks we still
    // catch them on the next tick (Created stays as 'created' until Paid).
    const settleCtxByInvoice = new Map<string, { payInToken: string; swapTxHash: string }>();
    for (const log of settleCtxLogs) {
      const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (d.eventName !== "SettlementContext") continue;
      const id = d.args.globalId as Hex;
      settleCtxByInvoice.set(id.toLowerCase(), {
        payInToken: (d.args.payInToken as string).toLowerCase(),
        swapTxHash: d.args.swapTxHash as string,
      });
    }

    // Audit MED-4 (2026-06-11), parity with replay.ts (Ops-L-2): every
    // chunk's DB writes are bracketed by BEGIN/COMMIT on a single client,
    // with setLastBlock(end) as the FINAL write inside the transaction. A
    // mid-chunk crash rolls back cleanly — no invoice flipped to paid
    // without its claimable_at sibling, no webhook enqueued for a row
    // update that never landed, no cursor advanced past unwritten rows.
    // The next tick re-walks the chunk; every handler is idempotent
    // (status-conditional UPDATEs, ON CONFLICT DO NOTHING inserts).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const log of createdLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "InvoiceCreated") continue;
        const a = d.args;
        const id            = a.globalId as Hex;
        const merchantAddr  = (a.merchant as string).toLowerCase();

        // Audit #20: dropped pre-check `select 1 from invoices`. ON CONFLICT
        // DO NOTHING is already idempotent, and the RETURNING here lets us
        // increment `created` only on actual inserts (duplicates return 0
        // rows). One round-trip per event instead of two on backfill.
        const mr = await client.query<{ id: string }>(
          "select id from merchants where lower(address) = $1 limit 1", [merchantAddr],
        );
        if (!mr.rowCount) continue; // unknown merchant - cannot satisfy FK

        // gateway_address comes from the log itself (log.address) so an
        // invoice discovered on V11 is recorded against the gateway that
        // actually emitted it during the dual-watch window.
        const sourceGateway = log.address.toLowerCase();
        const inserted = await client.query<{ id: string }>(
          `insert into invoices
             (id, merchant_invoice_id, merchant_id, pay_in_token, payout_token,
              amount_out, expires_at, status, success_url, metadata, gateway_address)
           values ($1, $2, $3, $4, $5, $6, to_timestamp($7), 'created', '', $8::jsonb, $9)
           on conflict (id) do nothing
           returning id`,
          [
            id,
            a.merchantInvoiceId as Hex,
            mr.rows[0].id,
            a.payIn as Hex,
            a.payoutToken as Hex,
            (a.amountOut as bigint).toString(),
            Number(a.expiresAt as bigint),
            JSON.stringify({ backfilled: true, txHash: log.transactionHash }),
            sourceGateway,
          ],
        );
        if (inserted.rowCount && inserted.rowCount > 0) {
          created++;
          backfilled++;
        }
      }

      for (const log of paidLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "InvoicePaid") continue;
        const id              = d.args.globalId as Hex;
        const payer           = d.args.payer as string;
        const amountIn        = (d.args.amountIn        as bigint).toString();
        // V13 fee model: InvoicePaid's 5th/6th args are invoiceAmountOut /
        // excessToEscrow — NOT merchantPayout / protocol fee. The settle-time
        // protocol fee is always 0 on V13; the ONLY protocol fee is taken at
        // claim time (InvoiceClaimed.fee), and merchant_payout equals
        // InvoiceClaimed.toMerchant — both written by the claimed handler
        // below. At paid-time we record protocol_fee = 0 and leave
        // merchant_payout null; the V13-only grossPayout / excessToEscrow
        // values are preserved in metadata (excess is merchant money routed
        // into escrow, paid back in full to the payer on refund).
        // V10–V12 addresses keep the original mapping exactly.
        const v13 = isV13Gateway(log.address);
        const merchantPayout: string | null =
          v13 ? null : (d.args.merchantPayout as bigint).toString();
        const protocolFee = v13 ? "0" : (d.args.fee as bigint).toString();

        const ctx = settleCtxByInvoice.get(id.toLowerCase());
        const meta: Record<string, unknown> = ctx
          ? { pay_in_actual: ctx.payInToken, swap_tx: ctx.swapTxHash, source_address: log.address }
          : { source_address: log.address };
        if (v13) {
          meta.gross_payout     = (d.args.grossReceived as bigint).toString(); // V13: grossPayout
          meta.excess_to_escrow = (d.args.fee           as bigint).toString(); // V13: excessToEscrow
        }
        // Block timestamp for catch-up replay accuracy (same pattern as
        // failed_at — paid_at and refunded_at both used DB now() before).
        const paidAt = new Date(await blockTsMs(log.blockNumber)).toISOString();
        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
             set status = 'paid', paid_by = $2, paid_tx = $3, paid_at = $8,
                 amount_in = $4, merchant_payout = $5, protocol_fee = $6,
                 metadata  = coalesce(metadata, '{}'::jsonb) || $7::jsonb
           where id = $1 and status = 'created'
           returning id, merchant_id`,
          [
            id, payer, log.transactionHash, amountIn, merchantPayout, protocolFee,
            JSON.stringify(meta),
            paidAt,
          ],
        );
        if (!upd.rowCount) continue;
        paid++;

        await enqueueWebhook(client, id, upd.rows[0].merchant_id, "invoice.paid",
          { paid_by: payer }, log.transactionHash);
      }

      for (const log of refundedLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "InvoiceRefunded") continue;
        const id         = d.args.globalId as Hex;
        const refundedTo = d.args.refundedTo as string;

        // Status guard widened to include 'created' so an out-of-order
        // InvoiceRefunded (landing before InvoicePaid) still flips the row to
        // refunded — without this, the row sticks in 'created' forever despite
        // the customer being made whole on-chain.
        const refundedAt = new Date(await blockTsMs(log.blockNumber)).toISOString();
        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
             set status = 'refunded', refund_tx = $2, refunded_at = $3
           where id = $1 and status in ('created', 'paid')
           returning id, merchant_id`,
          [id, log.transactionHash, refundedAt],
        );
        if (!upd.rowCount) continue;
        refunded++;

        await enqueueWebhook(client, id, upd.rows[0].merchant_id, "invoice.refunded",
          { refunded_to: refundedTo }, log.transactionHash);
      }

      for (const log of payerRefundedLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "PayerRefunded") continue;
        const id     = d.args.globalId as Hex;
        const payer  = d.args.payer as string;
        const amount = (d.args.amount as bigint).toString();

        // V10 path: the relayer couldn't settle, sent the customer their
        // pay-in back off-chain, and emitted this event so the indexer flips
        // the row to `failed`. webhooks fire so the merchant's app sees a
        // terminal "this won't pay" state.
        const failedAt = new Date(await blockTsMs(log.blockNumber)).toISOString();
        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
             set status   = 'failed',
                 metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb
           where id = $1 and status in ('created', 'paid')
           returning id, merchant_id`,
          [
            id,
            JSON.stringify({
              failed_at:    failedAt,
              failed_tx:    log.transactionHash,
              refunded_to:  payer.toLowerCase(),
              refund_amount: amount,
            }),
          ],
        );
        if (!upd.rowCount) continue;
        failed++;

        await enqueueWebhook(client, id, upd.rows[0].merchant_id, "invoice.failed",
          { payer: payer.toLowerCase(), amount }, log.transactionHash);
      }

      // EscrowCreated → set claimable_at on the invoice row.
      // Guard: only update rows still in 'paid' state with no claimable_at set.
      // This makes the handler idempotent on replay and protects against
      // out-of-order events overwriting a row that has already progressed to
      // claimed/refunded/recovered (first sighting wins).
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

      // InvoiceClaimed → flip status to 'claimed', record claim_tx and fee
      for (const log of claimedLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "InvoiceClaimed") continue;
        const id          = d.args.globalId as Hex;
        const fee         = (d.args.fee        as bigint).toString();
        const toMerchant  = (d.args.toMerchant as bigint).toString();

        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
             set status          = 'claimed',
                 claimed_at      = now(),
                 claim_tx        = $2,
                 protocol_fee    = $3,
                 merchant_payout = $4
           where id = $1 and status = 'paid'
           returning id, merchant_id`,
          [id, log.transactionHash, fee, toMerchant],
        );
        if (!upd.rowCount) continue;
        claimed++;

        await enqueueWebhook(client, id, upd.rows[0].merchant_id, "invoice.claimed",
          { fee, to_merchant: toMerchant }, log.transactionHash);
      }

      // EscrowRecovered → flip status to 'recovered'
      for (const log of escrowRecoveredLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "EscrowRecovered") continue;
        const id = d.args.globalId as Hex;

        const upd = await client.query<{ id: string; merchant_id: string }>(
          `update invoices
             set status       = 'recovered',
                 recovered_at = now(),
                 recovery_tx  = $2
           where id = $1 and status = 'paid'
           returning id, merchant_id`,
          [id, log.transactionHash],
        );
        if (!upd.rowCount) continue;
        recovered++;

        await enqueueWebhook(client, id, upd.rows[0].merchant_id, "invoice.recovered",
          {}, log.transactionHash);
      }

      // MerchantReactivated → clear deactivated_at.
      // Note: this is intentionally NOT guarded by a prior-state check. The
      // operator explicitly issued a reactivation on-chain, so clearing
      // deactivated_at is always correct. On replay, if a later deactivation
      // event also replays, it will re-set the column — the final DB state
      // will converge to whatever the most-recently-processed event dictates,
      // which is the correct observable on-chain state.
      for (const log of merchantReactivatedLogs) {
        const d = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
        if (d.eventName !== "MerchantReactivated") continue;
        const merchant = (d.args.merchant as string).toLowerCase();
        await client.query(
          `update merchants set deactivated_at = null where lower(address) = $1`,
          [merchant],
        );
      }

      // Cursor advance is the FINAL write inside the transaction: either the
      // whole chunk landed and the cursor moved, or neither happened.
      await setLastBlock(client, end);

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e; // surfaces as tick.error; next tick re-walks from the old cursor
    } finally {
      client.release();
    }

    cursor = end + 1n;
    chunks++;
  }

  return { from: last + 1n, to, created, backfilled, paid, refunded, failed, claimed, recovered, chunks };
}

async function main() {
  console.log(JSON.stringify({
    msg: "indexer.start", gateway: GATEWAY_V10, tickMs: TICK_MS, reorgBuffer: REORG_BUFFER.toString(),
  }));
  // Audit Ops-L-1 (2026-05-24): finish the in-flight chunk before tearing
  // the pool down. The indexer's cursor only advances after a chunk's
  // writes commit (Ops-L-2 transactional fix), so an abandoned mid-chunk
  // would always be picked up on next start anyway — but graceful drain
  // avoids the noisy "ECONNREFUSED" / "client end" lines in the log.
  let shuttingDown = false;
  const requestShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "indexer.shutdown_requested", signal }));
  };
  process.on("SIGINT",  () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  while (!shuttingDown) {
    try {
      const r = await tick();
      if (r.created || r.paid || r.refunded || r.failed || r.claimed || r.recovered || r.backfilled || r.chunks > 1) {
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          from: r.from.toString(), to: r.to.toString(),
          created: r.created, backfilled: r.backfilled, paid: r.paid,
          refunded: r.refunded, failed: r.failed, claimed: r.claimed, recovered: r.recovered,
          chunks: r.chunks,
        }));
      }
    } catch (e) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), msg: "tick.error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    if (shuttingDown) break;
    await new Promise<void>(r => setTimeout(r, TICK_MS));
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "indexer.shutdown_complete" }));
  await pool.end().catch(() => {});
  process.exit(0);
}

main();
