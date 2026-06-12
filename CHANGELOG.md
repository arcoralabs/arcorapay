# Changelog

All notable changes to Arcora are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows [Semantic Versioning](https://semver.org/) for the published `@arcora/*` npm packages.

## [Unreleased]

Public-beta launch work on `feat/public-beta-launch`. Not yet tagged. The `@arcora/sdk` source carries the AFG-019 security rework below; `@arcora/sdk` and `@arcora/sdk-react` are both prepped at **1.3.0** for the npm publish that ships these client-facing changes.

### Security
- **AFG-019 — browser keys can no longer act as server keys.** The docs previously told merchants to embed the privileged `ak_live_` secret key (which creates invoices, spends server-wallet gas, lists escrows, and reads private invoice data) directly in browser / CDN / React code. Introduced a browser-safe **publishable key (`pk_live_…`)**: `POST /api/invoices` now routes by key class — `pk_` may only open a checkout from an allowlisted Origin, `ak_` keeps full capability, unknown prefix is rejected. `lookupMerchantByApiKey` matches `ak_` only, so a browser key can never authorize escrows or private invoice fields. SDK `escrows()` throws `PUBLISHABLE_KEY_FORBIDDEN` for a `pk_` key, and constructing the SDK with a secret key in a browser warns. Migration `0020` adds the publishable-key column (plaintext + prefix index), generated at bootstrap and lazily backfilled for existing merchants. Docs/READMEs/SDK page now show `pk_` in client code with an explicit "secret = server-side only" callout.
- **2026-06-06 full-scope audit remediation sweep** (findings AFG-001 through AFG-021): webhook DNS pinned to the validated connection + hardened IP classifier (AFG-001/002); server-priced shop cart + abuse throttle (AFG-003/004); fail-closed compliance gate + soft refund-window semantics (AFG-005/013); CSRF coverage across all merchant routes + amount-string caps before `BigInt` (AFG-006/009); relayer gateway allowlist + strict pinned-CA database TLS (AFG-010/011); ops daemons run unprivileged and systemd-sandboxed (AFG-021).

### Added
- **UI v2 redesign** — new chartreuse-accent design system ported into the Tailwind theme (design tokens + component recipes in `globals.css`), with **dual light/dark themes** driven by a `data-theme` attribute (dark by default). Landing, hosted checkout, demo, and the full merchant area (shell, sidebar, dashboard, treasury) were restyled to v2; legacy aux surfaces migrated and the old style layer removed.
- **New Arcorapay brand** — redesigned Arcora symbol + two-tone "Arcorapay" wordmark, new favicon and metadata; typography moved to **Hanken Grotesk** (UI) and **IBM Plex Mono** (tabular numerals) via `next/font`.
- **Terms of Service + Privacy Policy pages** for the public beta (privacy deletion requests require wallet-ownership proof).
- **`/api/health` endpoint** for uptime monitoring (reports deploy SHA as version).
- **Ops health-check cron** covering the VPS daemons, webhook/settlement queue age, and the app endpoint, with hardened scripting (ERR trap, timeouts, `flock`, CA cleanup), an on-alert runbook, and optional `ntfy.sh` push alerts.
- **Cross-chain (v2) checkout** groundwork — shared v2 route core, prepare/burn-submit/status endpoints, cross-chain payment schema (migration `0021`), a CCTP attestation adapter, and a relayer payment state machine. (Testnet/preview; not part of the SDK publish.)

## [1.3.0] — 2026-06-12

Security point release for the published packages, cut from the 2026-06-11 audit follow-ups on `audit-fixes-2026-06-11`.

### Changed
- **BREAKING (`@arcora/sdk`): secret keys now throw in browser contexts.** Constructing the SDK with an `ak_…` secret key in a browser previously only `console.warn`ed (AFG-019 era); it now throws at construction time. Client code must use the publishable key (`pk_live_…`) — secret keys are server-side only.

### Added
- **`@arcora/sdk`: official webhook verifier** — `verifyWebhook` ships at the `@arcora/sdk/webhook` subpath (server-side only; uses `node:crypto`). Verifies the V2 signature (HMAC-SHA256 over `<timestamp>.<body>`) with a timing-safe compare and a replay window (default ±300 s).
- **`@arcora/sdk-react`**: `engines` field (`node >= 20`) and `typecheck` script; SECURITY JSDoc on `CheckoutButtonProps` documenting that `apiKey` must be the publishable key. Demo merchant flipped to a publishable-key-only guard.

### Deprecated
- **Webhook V1 signature (`X-Arcora-Signature`)** — it carries no timestamp, so a captured delivery is replayable. Deliveries now include `Deprecation: version=1` and a `Link: <…/docs/webhooks#v2>; rel="deprecation"` header; `/docs/webhooks` documents V2 + the SDK verifier as the verification method. V1 will be removed at mainnet launch.

## [1.2.0] — 2026-05-13

Hardening + hygiene point release on top of 1.1.0. No public SDK surface change versus 1.1.0; the npm artifacts were not re-cut for this tag.

### Security
- **Dependency audit cleared** — `pnpm audit` findings cut from 43 → 3 (all critical + high resolved). `next` bumped `^15.0.0 → ^15.5.18` across `packages/app` and `packages/shop`, covering the App Router SSRF, middleware/proxy bypass, XSS, cache-poisoning, and DoS advisories; `happy-dom` `^15 → ^20` (dev) closes the VM-context-escape RCE; `axios` forced via pnpm override to clear transitive highs. sdk-react verified non-breaking against the bump.

### Fixed
- **Dead-domain defaults** — SDK and WooCommerce default base URLs pointed at unregistered DNS (`checkout.arcorapay.com` / `checkout-staging.arcorapay.com`, which never had A records); a consumer who didn't pass an explicit `baseUrl` silently failed. Testnet and mainnet defaults now point at the resolving `arcorapay.xyz`; `PUBLIC_BASE_URL` fallback in the invoice route fixed; SDK test fixture aligned.

### Changed
- `.env.example` files refreshed to V11-correct shape; litepaper rewritten and pitch deck refreshed for the V11 / v1.1.0 era; real SDK docs in place of stale copy.

## [1.1.0] — 2026-05-13

Major feature release: a V10 custody gateway, multi-stable StableFX swap pools, a Vault-backed relayer, compliance Phase 0, a live dogfooding storefront, full `/docs`, and the first publishable `@arcora/sdk` CDN bundle. Also folds in two large audit-remediation passes (2026-05-19 and 2026-05-24).

### Added
- **`@arcora/sdk` 1.1.0 — drop-in `<script>` CDN bundle.** New `dist/arcora.global.js` IIFE build (`unpkg` / `jsdelivr` fields, `./global` export) so a merchant can load Arcora from a CDN without a bundler.
- **`@arcora/sdk` — V10 surface.** V10 ABI, `escrows()`, and `refundEndsAt` exposed in the client.
- **`Arcora` class for multi-tenant safety** (audit-h6) — replaces the global static `init()` singleton so a process can hold more than one merchant configuration; the static init path is deprecated.
- **V10 custody gateway** — escrow-per-invoice settlement (no on-settle transfer), permissionless `claimAll` that splits the escrow with the fee accrued at claim time, refunds that drain the escrow and make the customer whole, an admin recovery path for a deactivated merchant's escrow (+14d), merchant lifecycle / reactivate, token whitelist + pause, and constructor fee/window bounds. Deployed and wired across app, indexer, and DB (escrow schema migrations, V10 event handlers).
- **StableFX integration (plan-6)** — v0.7/v0.8 token-agnostic, pool-routed gateway with a `StablecoinRegistry`, per-token `PriceGuard`, and a cross-decimal `StablePool` (deposit/withdraw/pause, oracle-priced quote, swap + fee accrual). v0.8 hosted checkout UI with `targetOutput` quote mode; deterministic merchant payout.
- **Vault-backed relayer** — relayer authenticates via HashiCorp Vault and drops `RELAYER_PRIVATE_KEY` from disk (M1), signing through a viem custom signer backed by Vault's transit engine.
- **Compliance hooks Phase 0 (plan-5)** — pluggable screening adapters, an audit log, and a checkout compliance gate (Noop default).
- **Arcora Shop** — a live storefront that dogfoods the checkout end-to-end, with real product photography.
- **Full `/docs` section** — sidebar, prose styling, 10 pages; `docs.arcorapay.xyz/*` rewritten to `/docs/*`.
- **Merchant UX** — sidebar layout + KPI overview redesign, settle-currency picker (USDC/EURC), treasury Claim tab + permissionless `ClaimAllButton`, `/api/merchant/escrows` rollup, share/copy link in the create-invoice success state. Standalone invoices: `successUrl` is now optional.
- **Security headers** (audit-m14) — CSP, HSTS, X-Frame-Options on app + shop.

### Changed
- **Rebrand to Arcora** completed at the package level — `@arc-fx/*` workspace packages renamed to `@arcora/*`, and `@arcora/react` renamed to `@arcora/sdk-react`. Product surfaces renamed from "Arc FX Gateway" to "Arcora".

### Fixed
- Large audit-remediation sweeps on **2026-05-19** (High + Medium plan) and **2026-05-24** (contracts/ops/app findings): checkout authorize/submit rate limiting, constant-time `CRON_SECRET` comparison, SSRF hardening (IPv6 6to4 / hex / NAT64 / Teredo), invoice amount + metadata bounds, webhook replay protection (V2 sig + timestamp) and body-buffer caps, relayer refund-tx persistence + resume, graceful SIGTERM drain, and many app-side input/CSRF/env-validation fixes.
- SDK `createInvoice` pre-flight validates `amountUsdc` (audit #38); SDK refuses to fall back to `Math.random` for the Permit2 nonce (audit-m13); `sdk-react` `useCheckout` includes `opts.environment` in its memo deps.

[1.1.0]: https://github.com/arcoralabs/arcorapay/releases/tag/v1.1.0
[1.2.0]: https://github.com/arcoralabs/arcorapay/releases/tag/v1.2.0
[1.3.0]: https://github.com/arcoralabs/arcorapay/releases/tag/v1.3.0

## [1.0.3] — 2026-04-30

Marketing surface + docs alignment release. No contract changes; SDK npm artifacts unchanged. v0.6 gateway at `0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3` remains canonical.

### Added
- **`/checkout-demo`** — stand-alone simulated 5-step checkout walk-through (Invoice → Wallet → Quote → Pay → Settled). No wallet, no chain. Math derived from real Arcora constants (1.0863 oracle rate, 4 bps pool fee, 10 bps protocol fee). Linked from the landing's How-it-works section + footer.
- **Live settlement simulator on the landing** — replays the real v1.0.2 pay-flow against the on-chain Chainlink oracle, cycling USDC→USDC, EURC→USDC, USDC→EURC. Every figure derived from the deployed contract.
- **Dashboard preview** + **SDK code block** sections on the landing — Treasury chart and "Four lines, first settlement" snippet, with explicit "Illustrative" disclaimer where the chart numbers are placeholders.
- **Crosschain route diagram** (v2.0 visualisation) inline on landing. Animated source-chain → Arc settlement.
- **Roadmap rows** on the landing: v1.0 → v3.0 with phase pills.
- **Rich site footer** with Product / Developers / Resources columns. Every link points at something that actually exists today (no placeholder /about, /security, /compliance pages).
- **JetBrains Mono** added via `next/font` for tabular numbers.
- **Plan 4 spec** (internal) — v2.0 crosschain rewrites the previous CCTP plan around **App Kit Bridge** (Arc's recommended primitive) instead of raw `TokenMessenger` calls. Off-chain EIP-712 intent, single Arcora relayer, no new gateway contract.
- **README "How Arcora relates to Arc primitives"** subsection — frames Arcora as the merchant abstraction layer above StableFX / App Kit / Circle DCW / Refund Protocol. Stripe ↔ Visa shape.
- **Pitch deck refresh** — new "Arcora sits above Arc primitives" slide; gas-cost line corrected from "testnet ETH" to "USDC" (Arc settles gas in USDC).
- **Arc docs alignment** verified through the `arc-network` MCP. USDC, EURC, chain config, decimals, native gas — all confirmed against `docs.arc.network`.

### Fixed
- **EURC checkout math** — the demo's quote panel rendered `53.2287 EURC` for a $49 invoice. The rate was inverted (`1/ORACLE` instead of `ORACLE`); correct value is `~45.13 EURC`.
- **Crosschain diagram label overflow** — hub text was "CCTP+AMM" pushing past the 38-px circle; tightened to "AMM" with the CCTP semantic carried by the section heading. Settle box dropped its trailing ellipsis (`USDC · EURC · …` → `USDC · EURC`) and widened from 120 to 124.
- **Crosschain diagram animation** — switched dash-pattern math to `pathLength=100` so the pulse rides cleanly past the path edges instead of stranding a blob at the start.
- **Foundry deploy verification** — earlier in the v1.0.2 cycle, a foundry broadcast file reported `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL` for a tx that never confirmed. Operational note now logged in memory: always verify with `cast receipt` AND non-empty `cast code` before trusting foundry.
- Footer items rewritten as plain `<a>` because Next 15's typed routes don't accept dynamic `href` strings on `<Link>`.

### Operational
- `pnpm deploy:app` / `pnpm deploy:demo` / `pnpm pitch:pdf` / `pnpm pitch:html` scripts at repo root so deploys + pitch renders run from the right cwd. Multiple "wrong directory" Vercel errors had cluttered the dashboard before this.
- `.gitignore` adds `.vercel`.

[1.0.3]: https://github.com/arcoralabs/arcorapay/releases/tag/v1.0.3

## [1.0.2] — 2026-04-29

Refunds, treasury dashboard, and one nasty deploy lesson. SDK npm artifacts unchanged so no version bump there.

### Added
- **Refunds (`v1.x #1`)** — `refundInvoice(bytes32)` on the gateway, callable by merchant or owner. Pulls the original `merchantPayout` from the merchant's wallet (requires `payoutToken` approve), forwards to `inv.paidBy`, and returns the protocol fee from accrued back to the merchant. Reverts cleanly on `InvoiceNotRefundable` and `InsufficientFeesForRefund` when the owner has already withdrawn fees. New `payments[globalId]` mapping records exact `(merchantPayout, fee)` at pay-time so refunds don't have to re-derive them. New `Refunded` enum value, `InvoiceRefunded` event, 8 foundry tests (suite at 117).
- **Treasury dashboard (`v1.x #2`)** at `/m/treasury` — per-stable KPI cards (net received, gross volume, refunded, fees) plus a 20-row activity feed with refunds shown as negative deltas. New `/api/merchant/treasury` aggregate. Migration `0002` adds `amount_in`, `merchant_payout`, `protocol_fee` numeric columns to the invoices table; the indexer populates them from the `InvoicePaid` event going forward.
- Refund button on the dashboard's invoice list with the same hardened state machine as `PayButton` (allowance pre-check, single-prompt when sufficient, retry-without-re-approve on revert).
- Webhook event `invoice.refunded` enqueued by the indexer when it sees `InvoiceRefunded`.

### Fixed
- **Foundry broadcast can lie on Arc testnet.** A `forge script --broadcast` reported `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL` and wrote a clean broadcast file at address `0xf127c79c…`, but `cast tx` returned `tx not found` and the address had no bytecode. A user `pay()` against the empty address technically succeeded as a no-op (status `0x1`, zero logs). Redeployed v0.6 with `--legacy` at `0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3` (deployTx `0x78f8da52…`); verified by reading `cast code` before claiming success. Operational note in `RELEASING.md`-equivalent memory: always verify deploys with `cast receipt` (status=1) AND non-empty `cast code` before trusting foundry's broadcast file.

### Operational
- v0.5 deprecated; v0.6 canonical at `0x7c113740E8FcFE03C05F2e9426e9F25F208Fb7a3`. Vercel envs and the VPS `arcora-indexer.service` `.env` repointed; daemon restarted.
- DB migrations `0001_stale_newton_destine.sql` (refund columns + enum value) and `0002_legal_flatman.sql` (treasury columns) applied to Neon prod.

[1.0.2]: https://github.com/arcoralabs/arcorapay/releases/tag/v1.0.2

## [1.0.1] — 2026-04-29

Hotfix release. Live EURC↔USDC swap payments reverted on-chain with `InsufficientOutput(999_999, 1_000_000)`; the gateway's linear `_estimateAmountIn` fell one wei short of the actual `OracleAMM.calculateSwap` output, and the customer-supplied `maxAmountIn` couldn't compensate because `pay()` sized the swap from the gateway's own estimate. The hosted checkout reported `Paid ✓` for these reverted txs, masking the failure until the indexer left the rows at `created`.

### Fixed
- **Gateway v0.5** (`0xf9537ab0934105966dce1ebfe9e9725e22cd82c0`) — `_estimateAmountIn` now seeds with the linear ceiling estimate, then walks forward 1 wei at a time (cap 8 steps) until `pool.calculateSwap >= amountOut`. Bounded so a degenerate pool can never freeze `pay()`. Regression test (`ShortByOnePool`) covers the 1-wei case explicitly. Deploy tx: `0xe9a79b551d312a1874c892bd91691399fd8510ac2806417cf79077134a6437a3`.
- **`PayButton`** now reads `receipt.status` from `waitForTransactionReceipt` and throws on `"reverted"`. Previously the UI flipped to `Paid ✓` on any included tx, including reverts.
- **`PayButton`** pre-reads the ERC-20 allowance and skips `approve()` if it's already sufficient, so a retry after a failed `pay()` doesn't re-prompt approve. Adds an explicit `"Awaiting payment confirmation…"` state between approve receipt and the second wallet popup so the user knows two prompts are coming.
- **`QuoteDisplay`** widens the customer-side EURC cushion from `+1%` to `+2% + 1000 wei` to absorb the forward/reverse-swap rounding gap. (Belt and braces — the on-chain fix above is the actual cure; the cushion guards against future quote-engine drift.)

### Operational
- v0.4 deprecated and recorded as such in `packages/contracts/deployments/arc-testnet.json`. Existing v0.4 invoices in the DB stay as-is; the indexer/webhook daemons now point exclusively at v0.5 (Vercel envs + VPS `arcora-indexer.service` `.env` updated and the daemon restarted).
- npm packages (`@arcora/sdk`, `@arcora/sdk-react`) untouched — their source surface didn't change.

[1.0.1]: https://github.com/arcoralabs/arcorapay/releases/tag/v1.0.1

## [1.0.0] — 2026-04-28

First shippable Arcora release. Arc-only stablecoin checkout and FX settlement: merchants take USDC or EURC, customers pay with USDC or EURC, the on-chain gateway swaps and settles atomically.

### Added
- **Arcora Gateway v0.4** at `0xA80A5741a09bff1f43dcBF15Df7c598A23163302` on Arc testnet.
- **`@arcora/sdk`** — three-function checkout client (`init` / `createInvoice` / `openCheckout`), zero EVM deps, ~1.5 KB gzipped.
- **`@arcora/sdk-react`** — `<CheckoutButton />` and `useCheckout()` for drop-in React integration.
- **Hosted checkout app** (now live at [`arcorapay.xyz`](https://arcorapay.xyz)): SIWE merchant auth, invoice creation via server hot wallet, customer-side wallet connect (MetaMask + WalletConnect), live FX quote display.
- **Merchant dashboard** under `/m/`: invoice list, create new, share QR, API key + webhook URL settings.
- **VPS-resident ops daemons** (`arcora-indexer.service`, `arcora-webhooks.service`) with systemd `Restart=always`, replacing Vercel cron for chain → DB sync and webhook delivery.
- **OracleAMM** Chainlink-priced two-token swap pool for USDC ⇄ EURC, ± 4 bps fee, ± 0.5% deviation guard.
- **Demo merchant** (`packages/demo-merchant/`) wired to `@arcora/sdk` showing a 5-line integration.
- **Arcora brand identity** applied across surfaces: blue `#2563FF`, teal `#00C2A8`, slate `#0B1426`; symbol + wordmark logo; Inter typography.

### Contract surface (v0.4 changes vs earlier dev iterations)
- Namespaced invoice IDs — `globalId = keccak256(merchant, merchantInvoiceId)` so two merchants can reuse the same `merchantInvoiceId`.
- Merchant struct gains `payoutAddress` (separate from `msg.sender`) and an `active` flag; `updatePayoutAddress`, `updatePayoutToken`, `deactivateMerchant` added.
- Same-token branch in `pay()` skips the AMM round-trip when `payInToken == payoutToken`.
- `InvoicePaid` event split into 6 fields: `(globalId, payer, amountIn, grossReceived, merchantPayout, fee)`.
- Each invoice locks its `payoutToken` at creation; later merchant updates do not reroute pending invoices.

### Tests
- Contracts (Foundry): 99 passing — unit + fuzz (10k runs) + invariant (256 × 64) + deploy scripts.
- App (vitest): 42 passing.
- App (Playwright E2E): 5 critical flows passing.
- SDK (vitest): 8 passing.
- `@arcora/sdk-react` (vitest): 3 passing.

### Known limitations
- Single AMM pool (USDC/EURC); other stables (USDT, PYUSD, DAI, regional) deferred to v1.x.
- Single chain (Arc testnet). Crosschain payment from any CCTP-supported chain is the v2.0 milestone.
- Mock Chainlink feed on testnet — a VPS systemd timer keeps it fresh; mainnet replaces this with the real Chainlink EUR/USD feed.

[1.0.0]: https://github.com/arcoralabs/arcorapay/releases/tag/v1.0.0
