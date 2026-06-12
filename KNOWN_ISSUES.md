# Known issues — tester preview

This file is the canonical "what's rough on purpose" list for the testnet preview at [arcorapay.xyz](https://arcorapay.xyz). Mirrored on the [`/quickstart`](https://arcorapay.xyz/quickstart) page in a tester-friendly form.

If you hit something that **isn't** listed here, that's a bug — please report it (`support@arcorapay.xyz` for general, `compliance@arcorapay.xyz` for security).

---

## Network / environment

- **We're on Arc Testnet only** — Arc itself is on testnet, so we are too. Mainnet T-0 is gated on Arc going mainnet. Treat this preview as a working demo, not a production payment rail.
- **No real money moves.** Faucet-issued USDC + EURC. Don't send real funds — they won't reach mainnet from here.
- **Single-instance relayer.** One VPS handles every settle and refund. If it's slow or briefly down, your invoice queues up and processes when it's back. Multi-relayer with rolling failover is on the v1.x ops list.

## Tokens

- **Pay-in / payout: USDC and EURC only.** App Kit Swap on Arc Testnet supports only USDC ⇄ EURC today. USDT, PYUSD, DAI, USDe are mainnet-only on App Kit's alias list; we'll list them as Arc opens those on testnet or as we move to mainnet (see Plan 3).
- **No regional stables (TRYC / BRLC / MXNC).** Not on Arc, not in App Kit aliases. Out of v1.x scope.
- **No USYC.** Institutional yield-bearing stable; allowlist + $100k floor. Separate institutional track.

## Compliance

- **Sanctions screening is in shadow mode.** `/api/checkout/authorize` exists and writes audit rows; the active provider is Noop on testnet — no wallet is rejected today. Mainnet flips it to a real Elliptic / TRM Labs adapter via env, no code change.
- **No KYB on testnet.** Mainnet will gate merchant onboarding behind a hybrid KYB flow (Manual + Persona, see Plan 8). Today any wallet can register as a merchant via SIWE signature alone.

## Refunds & webhooks

- **Refunds need no merchant approval.** The custody-escrow gateway holds each invoice's payout inside the contract until the 7-day window matures. During that window `refundInvoice(globalId)` drains the escrow straight back to the customer (`ArcFXGateway.sol`) — no ERC-20 allowance and no wallet popup from the merchant. (This replaced the older pull-from-merchant-wallet refund model; the dashboard button is a single `refundInvoice` call.)
- **Webhooks retry 5× over 30 minutes, then stop.** If your webhook endpoint is down longer than that, fetch missed events via the API. Long-term retry policy is on the v1.x list.

## Operational caveats

- **Foundry broadcast can lie.** On Arc testnet, `forge script --broadcast` has been observed reporting success while the tx silently failed to confirm. We always verify with `cast receipt` (status=1) AND `cast code <addr>` (non-empty), and re-run those checks before trusting any redeploy.
- **Drizzle migration tracking is out of sync on the production database.** Migrations 0000–0005 were applied via direct SQL exec rather than `drizzle-kit migrate`, so the migrations journal does not reflect prod state. Any future migration must be reconciled against the live schema before running `drizzle-kit migrate`.

## Versioning

| Surface | Status |
|---|---|
| Gateway `ArcFXGateway` (version-neutral) | live, canonical — `packages/contracts/src/ArcFXGateway.sol` |
| Pre-retirement deploys (≤ v1.1) | retired 2026-05-20 (testnet wiped); kept in git history only, no `legacy/` dir |
| `@arcora/sdk` + `@arcora/sdk-react` | 1.0.0 published on npm; 1.2.0 prepared (version-synced, ships the publishable-key rework), publish pending (2FA user step) |
| Compliance hooks | Phase 0 LIVE (Noop default) — Plan 5 |
| Audit prep | Layers 1+2 LIVE (zero-budget path) — Plan 7 |
| KYB | spec'd two-track (Manual + Persona), not built — Plan 8 |
| Mainnet target | gated on Arc Network mainnet (Arc-dependent) |

---

## Reporting

- General feedback / bugs: `support@arcorapay.xyz` or [GitHub issues](https://github.com/arcoralabs/arcorapay/issues)
- Security disclosure: `compliance@arcorapay.xyz` ([SECURITY.md](SECURITY.md))

We aim to acknowledge within 24h. Coordinated disclosure expected for security findings.
