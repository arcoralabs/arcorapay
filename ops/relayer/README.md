# arcora-relayer

Long-running daemon that drains `relayer_queue`, runs `kit.swap` on Arc Testnet, and tells `ArcFXGatewayV8` to settle the invoice. Customers sign a single Permit2 EIP-712 message in their wallet (gas-less, no tx); the relayer does all the on-chain work.

Source of truth lives in `run.ts` (daemon), `replay.ts` (recovery CLI), and `smoke.ts` (Phase A bring-up). This README is operator-facing.

## Files

| | |
|---|---|
| `run.ts` | The daemon. Loops every `RELAYER_TICK_MS` (default 5s); claims a `pending` row → calls `Permit2.permitWitnessTransferFrom` → `kit.swap` → `gateway.settleInvoice`. On `kit.swap` failure, transfers pay-in back to payer and calls `gateway.recordPayerRefund`. |
| `replay.ts` | Operator CLI. `list`, `requeue`, `force-refund`. Use when a row gets stuck in `processing` or `failed`. |
| `smoke.ts` | One-shot Phase A bring-up — verifies App Kit Swap is alive on Arc testnet before committing to the rest. |
| `arcora-relayer.service` | Systemd unit. `Type=simple`, `Restart=always`, `EnvironmentFile=/root/arcora-ops/relayer/.env`. |
| `package.json` | npm scripts: `pnpm start`, `pnpm replay …`, `pnpm smoke`. |

## Daily ops

```bash
# liveness
ssh root@<ops-vps> 'systemctl is-active arcora-relayer'
# logs
ssh root@<ops-vps> 'journalctl -u arcora-relayer -f'
# restart after env change (new gateway, new kit key, etc.)
ssh root@<ops-vps> 'systemctl restart arcora-relayer'
```

## Recovery — `replay.ts`

Three reasons a row can get stuck:

1. The daemon crashed mid-process; the row is now in `processing` and the daemon won't re-pick it.
2. `kit.swap` is failing repeatedly (testnet liquidity gone, kit key revoked, etc.); the row hits `RELAYER_MAX_ATTEMPTS` and lands in `failed`.
3. Both `kit.swap` and the auto-refund failed; the row is in `failed` with funds stranded in the relayer hot wallet.

`replay.ts` is what you reach for. **It does not run as a daemon.**

### `list` — see what's stuck

```bash
cd /root/arcora-ops/relayer
pnpm replay list                         # default: pending, processing, failed
pnpm replay list --status processing     # only stuck-mid-flight
```

### `requeue` — re-try after fixing the upstream

```bash
pnpm replay requeue --id 7c3d…
```

Flips a `failed` or `processing` row back to `pending` with `attempts = 0` and `next_attempt = now()`. The daemon picks it up on its next tick (≤ 5s). Use after the upstream issue is resolved (App Kit liquidity restored, RPC outage cleared, gateway un-paused).

### `force-refund` — operator escape hatch

```bash
pnpm replay force-refund --id 7c3d…
```

Calls `gateway.recordPayerRefund` and marks the queue row `refunded`. **You are responsible for actually moving the pay-in token back to the customer first** (out of band — the script does not transfer tokens). Use when the auto-refund path failed (e.g. RPC was down when the daemon tried to send the payer ERC-20 transfer) and you've already settled the customer manually.

### What `replay` cannot do

- It does not retry an already-`settled` row. Settlement is final on-chain; if a customer disputes, use the merchant-driven `refundInvoice` flow on the gateway, not this tool.
- It does not pull funds from the gateway. Force-refund only emits the recording event so the indexer flips the invoice to `failed`.

## Permit2 typed-data shape

The `permit2_data` JSONB column stores the customer's signed message in this shape:

```json
{
  "nonce":             "<uint256 string>",
  "deadline":          "<unix timestamp string>",
  "witness":           "0x<32 bytes — keccak of trade context>",
  "witnessTypeString": "ArcoraSwapIntent witness)ArcoraSwapIntent(bytes32 invoiceId,address relayer)TokenPermissions(address token,uint256 amount)"
}
```

The witness binds the signature to a specific invoice + relayer, so a captured signature can't be replayed against a different trade.

## Env

Copy `.env.example` and fill in. The smoke test (`pnpm smoke`) needs `PRIVATE_KEY`, `KIT_KEY`, `FEE_RECIPIENT`. The daemon (`pnpm start`) additionally needs `RELAYER_PRIVATE_KEY`, `POSTGRES_URL_NON_POOLING`, `GATEWAY_ADDRESS`, `CUSTOM_FEE_RECIPIENT`. `.env` lives at `/root/arcora-ops/relayer/.env`, chmod 600.

## Phase A — testnet smoke (one-shot)

Goal: confirm `kit.swap` works on Arc testnet from a Node.js script before committing to the daemon. If maker liquidity is thin or the kit returns errors, escalate to Circle support before building the rest.

```bash
cd ops/relayer
pnpm install
cp .env.example .env
# fill PRIVATE_KEY (testnet hot wallet, ~$1 USDC), KIT_KEY (Circle Console),
#      FEE_RECIPIENT (any address you control)
pnpm smoke
```

Three steps in order: `estimateSwap` → `swap` no-fee → `swap` with 1% customFee. Each prints latency. Pass criteria: all three succeed, fee recipient gains 90% of the configured percentage of the third swap.
