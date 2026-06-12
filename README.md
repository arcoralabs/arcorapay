# Arcorapay

**Stablecoin checkout & settlement on [Arc](https://arc.network) — accept any supported stablecoin, settle in the one you choose.**

_An [Arcora Labs](https://github.com/arcoralabs) product._

[![Live beta — arcorapay.xyz](https://img.shields.io/badge/live%20beta-arcorapay.xyz-2563FF)](https://arcorapay.xyz) &nbsp; [![Network](https://img.shields.io/badge/network-Arc%20testnet-00C2A8)](https://arc.network) &nbsp; [![License](https://img.shields.io/badge/license-MIT-black)](LICENSE)

Merchants invoice in their preferred stablecoin; customers pay with the stablecoin they hold and sign a **single Permit2 message** — no transaction, no gas. Arcorapay's relayer pulls the funds, runs the FX swap on Arc, and settles the merchant's payout into a per-invoice custody escrow inside the gateway contract. Sub-30s end-to-end, refunds with no merchant approval.

```ts
import { Arcora } from "@arcora/sdk";

const arcora = new Arcora({ apiKey, environment: "testnet" });
const inv = await arcora.createInvoice({ amountUsdc: 49.99, payInToken: "EURC", successUrl: "..." });
arcora.openCheckout(inv);
```

> ### ⚠️ Public testnet beta
> Arcorapay runs on **Arc testnet** (chain id `5042002`). All assets are faucet-issued **test tokens with no monetary value** — do not send real funds. Treat the live beta at [arcorapay.xyz](https://arcorapay.xyz) as a working demo, not a production payment rail. Mainnet is gated on Arc Network going mainnet. See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for the current rough edges.

## What it does

- **Custody-escrow gateway.** `settleInvoice` deposits the merchant's exact payout into a per-invoice escrow inside the contract, claimable after a 7-day refund window. The gateway never holds the pay-in token and has no oracle or pool.
- **Permit2 gas-less checkout.** The customer signs one EIP-712 message authorising the relayer to pull the pay-in. No on-chain transaction and no native gas on the customer's side.
- **StableFX swap via Circle App Kit.** The relayer drives `kit.swap` on Arc to convert the pay-in stablecoin into the merchant's payout stablecoin; execution settles through Arc's RFQ maker network. Arcorapay runs no in-house AMM.
- **Publishable / secret key model.** Merchants get a browser-safe publishable key (`pk_…`) for client code and a server-side secret key (`ak_…`) that never needs to ship to the browser.
- **Webhooks with HMAC.** Deliveries are signed with HMAC-SHA256 over the raw body (`X-Arcora-Signature`), with timestamped V2 signatures + replay protection; verification is a three-line constant-time compare.
- **Merchant dashboard.** SIWE-authenticated dashboard for invoices, escrow buckets (pending / matured / claimed), per-stable treasury rollups, API keys, webhook config, and on-chain delegate authorization.
- **SDK + CDN bundle.** `@arcora/sdk` (~1.5 KB gzipped, ESM + CJS + IIFE) and `@arcora/sdk-react` (`<CheckoutButton />` + `useCheckout()`). The IIFE build is loadable straight from jsDelivr/unpkg for a no-build `<script>` integration.
- **WooCommerce plugin.** A WordPress / WooCommerce gateway (`plugins/arcora-woocommerce`) ships in-tree.

## Architecture

```
arcorapay/
├── packages/
│   ├── app/              Next.js 15 hosted checkout + merchant dashboard + HTTP API
│   ├── contracts/        Solidity (Foundry) — ArcFXGateway custody-escrow contract
│   ├── sdk/              @arcora/sdk — three-function checkout client + CDN bundle
│   ├── sdk-react/        @arcora/sdk-react — React hook + button component
│   ├── crosschain-core/  v2 crosschain route core (App Kit Bridge), feature-flagged
│   ├── shop/             Storefront dogfooding the checkout
│   └── demo-merchant/    Vite app integrating the SDK in ~5 lines
├── ops/
│   ├── indexer/          VPS daemon — reconciles chain events → Postgres
│   ├── relayer/          VPS daemon — pulls Permit2, runs swap, calls settleInvoice
│   ├── webhooks/         VPS daemon — HMAC-signs + delivers merchant webhooks
│   ├── vault/            HashiCorp Vault config for the relayer signer
│   └── health/           Ops health monitoring for the daemons
└── plugins/
    └── arcora-woocommerce/   WordPress / WooCommerce payment gateway
```

The contract is the smallest moving part: an invoice-lifecycle machine plus the custody escrow plus a protocol-fee accumulator. It does not swap and does not orchestrate. The relayer is the only off-chain actor with `RELAYER_ROLE`; the indexer and webhook daemons are passive readers. Full design rationale is in [`docs/LITEPAPER.md`](docs/LITEPAPER.md).

## Quickstart (developers)

```bash
pnpm install
pnpm --filter @arcora/app db:up           # docker compose up -d postgres
cp packages/app/.env.example packages/app/.env
# fill MASTER_KEY, IRON_SESSION_PASSWORD, CRON_SECRET
pnpm --filter @arcora/app db:push
pnpm --filter @arcora/app dev              # http://localhost:3000
```

For the full local setup (server hot wallet provisioning, Vercel deploy), see [`packages/app/README.md`](packages/app/README.md).

- **Docs:** the developer reference is served at [arcorapay.xyz/docs](https://arcorapay.xyz/docs) and lives under [`packages/app/app/docs`](packages/app/app/docs).
- **Litepaper:** [`docs/LITEPAPER.md`](docs/LITEPAPER.md) — the bet, the settlement flow, the custody-escrow design, trust boundaries, and audit status.
- **Roadmap:** [`docs/ROADMAP.md`](docs/ROADMAP.md) — forward phases (v2 crosschain → v3 intent/solver) and the pre-mainnet checklist.

## Live deployment

The current release (v1.2) runs on Arc testnet. The canonical machine-readable record is [`packages/contracts/deployments/arc-testnet.json`](packages/contracts/deployments/arc-testnet.json).

| | Where |
|---|---|
| **Hosted checkout** | [arcorapay.xyz](https://arcorapay.xyz) |
| **ArcFXGateway** (custody escrow) | [`0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3`](https://testnet.arcscan.app/address/0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3) |
| **Relayer hot wallet** | [`0x29EcFedDF31E4dA4a62b89bADe35b224cE144DAE`](https://testnet.arcscan.app/address/0x29EcFedDF31E4dA4a62b89bADe35b224cE144DAE) |
| **Permit2** | [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://testnet.arcscan.app/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |
| **USDC / EURC** | `0x3600…0000` / `0x89B5…D72a` (Circle-managed canonical) |

Gateway parameters: protocol fee 30 bps, refund window 7 days, admin recovery delay 7 days. USDC + EURC pre-whitelisted. Pre-retirement deployments (≤ v1.1) were retired on 2026-05-20 (testnet wiped) and remain only in git history.

## Packages

| Package | Description |
|---------|-------------|
| [`@arcora/sdk`](packages/sdk/) | npm SDK — three-function client, ~1.5 KB gzipped, CDN bundle |
| [`@arcora/sdk-react`](packages/sdk-react/) | React hook + button component |
| [`@arcora/app`](packages/app/) | Next.js 15 hosted checkout + merchant dashboard |
| [`@arcora/contracts`](packages/contracts/) | Solidity contracts (Foundry) |
| [`@arcora/crosschain-core`](packages/crosschain-core/) | v2 crosschain route core (feature-flagged) |
| [`@arcora/demo-merchant`](packages/demo-merchant/) | Vite app integrating the SDK in ~5 lines |
| [`@arcora/shop`](packages/shop/) | Storefront dogfooding the checkout |

## Security

Disclosure policy and scope are in [`SECURITY.md`](SECURITY.md) — please report privately through GitHub Security Advisories.

**Audit status, honestly:** the contract, app, SDKs, and ops surface have been through several **internal** full-scope audit passes, and every finding has been remediated in-repo. **No external audit has been performed yet** — an external audit is a hard pre-mainnet requirement, tracked alongside the rest of the go-live checklist in [`docs/ROADMAP.md`](docs/ROADMAP.md). A live Immunefi bug bounty is planned for mainnet T-0.

## Releasing

See [`RELEASING.md`](RELEASING.md) for the SDK npm publish + Vercel deploy + tag steps.

## License

MIT — see [`LICENSE`](LICENSE).
