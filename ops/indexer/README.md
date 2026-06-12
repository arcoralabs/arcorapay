# arcora-indexer

Long-running daemon that walks Arc testnet chunk-by-chunk, mirrors `InvoiceCreated` / `InvoicePaid` / `InvoiceRefunded` events into Neon, and enqueues webhook attempts for the dispatcher daemon.

Source of truth lives in `run.ts`. This README is operator-facing.

## Files

| | |
|---|---|
| `run.ts` | The daemon. Loops every `INDEXER_TICK_MS` (default 30s), pulls events from `last_processed_block + 1` up to `head − INDEXER_REORG_BUFFER_BLOCKS`, advances `indexer_state.last_processed_block` after each successful chunk. |
| `replay.ts` | One-shot recovery CLI. Two subcommands — `reset` and `replay` — for fixing an out-of-sync DB without taking the daemon down. |
| `arcora-indexer.service` | Systemd unit. `Type=simple`, `Restart=always`, `EnvironmentFile=/root/arcora-ops/indexer/.env`. |
| `package.json` | npm scripts: `pnpm start` (run the daemon), `pnpm replay …` (the CLI below). |

## Daily ops

```bash
# liveness
ssh root@<ops-vps> 'systemctl is-active arcora-indexer'
# logs
ssh root@<ops-vps> 'journalctl -u arcora-indexer -f'
# restart after env change (e.g. new gateway address)
ssh root@<ops-vps> 'systemctl restart arcora-indexer'
```

## Recovery — `replay.ts`

Two ways the indexer's `last_processed_block` and the DB can drift apart:

1. The daemon was offline for a long stretch (rare; systemd restarts).
2. A bug landed in `run.ts`, processed events, and was reverted; the events need to be re-applied with the fixed code.

`replay.ts` exists for both. **It does not run as a daemon.** It's a manual operator tool.

### `reset` — rewind the cursor

```bash
cd /root/arcora-ops/indexer
pnpm replay reset --to-block 39600000
```

Sets `indexer_state.last_processed_block = 39600000`. The running daemon picks this up on its next tick (≤ 30 s) and starts walking forward from `39600001`. Use this when you want the daemon to re-process a recent stretch with code that's already deployed.

### `replay` — one-shot range walk, no state change

```bash
cd /root/arcora-ops/indexer
pnpm replay replay --from 39600000 --to 39610000 [--dry-run]
```

Walks `[from, to]` in 9k-block chunks, marks any missing `paid` / `refunded` invoice rows, queues webhook attempts (with `replay: true` flag in the payload so receivers can de-dupe), and **does not touch `last_processed_block`**. Use this for surgical backfills without disturbing the daemon's cursor — e.g. a customer reports an old paid invoice missing in the dashboard.

`--dry-run` prints the rows that would change, no DB writes. Always run dry first.

### What `replay` cannot do

- It does not write `InvoiceCreated` rows. The application's `/api/invoices` route owns invoice creation; replay can only flip an existing `created` row to `paid`, or `paid` to `refunded`. If the create event itself was missed, fix that via the application path (or a SQL backfill — separate ticket).
- It does not reorder webhooks already in flight. New attempts are enqueued at `next_attempt = now()`; they coexist with whatever the dispatcher daemon was doing.
- It does not catch up `merchants` or `indexer_state` schema migrations. Run `drizzle-kit migrate` first if you've shipped a schema change.

## Env

```
ARC_TESTNET_RPC=…
GATEWAY_ADDRESS_V10=0xc91e45ffe945c0e6e2c0f8262a35477e20a5f154   # V10 custody (canonical, Plan 10)
POSTGRES_URL_NON_POOLING=…
INDEXER_REORG_BUFFER_BLOCKS=5     # optional, default 5
INDEXER_TICK_MS=30000             # optional, default 30s
```

`.env` lives at `/root/arcora-ops/indexer/.env`, chmod 600. Sourced by both the systemd unit (via `EnvironmentFile=`) and `replay.ts` (via Node's process.env when run from this directory).
