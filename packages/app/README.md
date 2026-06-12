# @arcora/app

Next.js 15 app hosting customer checkout (`/i/[invoiceId]`) and merchant dashboard (`/m/*`) for Arcorapay.

## Local development

```bash
cp .env.example .env   # fill in local values + MASTER_KEY
docker compose up -d postgres
pnpm db:push
pnpm tsx scripts/provision-server-wallet.ts   # one-time
# add the printed address to NEXT_PUBLIC_SERVER_WALLET_ADDRESS in .env
# fund it from https://faucet.circle.com (Arc Testnet)
pnpm dev
```

Visit http://localhost:3000.

## Tests

```bash
pnpm test           # vitest — unit + UI + the no-fabricated-content copy guard
pnpm e2e            # playwright (critical flows)
```

## Pages

| Route | Audience | Description |
|-------|----------|-------------|
| `/` | public | Minimal landing page |
| `/i/[invoiceId]` | customer | Stripe-style hosted checkout — wallet connect, FX quote, approve+pay, mobile QR handoff |
| `/m/login` | merchant | SIWE auth |
| `/m/dashboard` | merchant | Invoice list, create new, share QR |
| `/m/settings` | merchant | API key, webhook URL, on-chain delegate authorization |
| `/api/invoices` | server-paid | POST: create invoice on-chain via `createInvoiceFor` |
| `/api/invoices/:id` | public | GET: invoice mirror from DB |
| `/api/quote` | public | GET: live pool quote |

> Chain → DB sync and HMAC-signed webhook delivery both run as long-running daemons on the VPS — see `ops/indexer/` and `ops/webhooks/`. Vercel handles only the request-path API; no Vercel cron is in use.

## Architecture

- **Tailwind v4** with the UI v2 design system in `app/globals.css` (chartreuse accent, green-tinted neutrals, semantic `--fg-*`/`--surface*`/`--border*` tokens, light + dark themes)
- **shadcn/ui** primitives mapped to the semantic theme variables
- **Hanken Grotesk** for display and body, **IBM Plex Mono** for code/numerics
- **wagmi 2 + viem 2** for chain reads/writes
- **thirdweb v5** for customer-side wallet connect (WalletConnect QR included)
- **iron-session** for SIWE-backed merchant auth
- **drizzle-orm + Supabase Postgres** (node-postgres `pg` driver, with the Supabase pooler CA pinned for verify-full TLS) for state
- **VPS systemd daemons** (`ops/indexer/`, `ops/webhooks/`, `ops/relayer/`) own chain → DB sync, HMAC webhook delivery, and the settle pipeline. The only Vercel cron is a daily SIWE-nonce cleanup (`vercel.json`).

## Env vars

| Var | Purpose |
|-----|---------|
| `POSTGRES_URL` | Postgres connection string (Supabase in production; plain Postgres for local dev) |
| `MASTER_KEY` | AES-256-GCM key for server wallet keystore + webhook secrets |
| `IRON_SESSION_PASSWORD` | Cookie session password (≥32 chars) |
| `CRON_SECRET` | Bearer token guarding `/api/cron/*` |
| `GATEWAY_ADDRESS` | Arcora Gateway (`ArcFXGateway.sol`) address |
| `POOL_ADDRESS`, `ORACLE_ADDRESS`, `USDC_ADDRESS`, `EURC_ADDRESS` | Contract addresses |
| `ARC_TESTNET_RPC` | Arc testnet RPC endpoint |
| `INDEXER_REORG_BUFFER_BLOCKS` | Default `5` — how far back from head to scan |
| `PUBLIC_BASE_URL` | Server-side base URL (used in invoice URLs) |
| `NEXT_PUBLIC_*` | Browser-exposed mirrors of the above |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | from cloud.walletconnect.com (free) |
| `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` | from thirdweb.com (free) |
| `NEXT_PUBLIC_SERVER_WALLET_ADDRESS` | output of `provision-server-wallet.ts` |

## Deploy

The hosted app deploys to Vercel (Root Directory = `packages/app`). See the repo-root [`RELEASING.md`](../../RELEASING.md) for the full deploy + alias walkthrough.

## License

MIT.
