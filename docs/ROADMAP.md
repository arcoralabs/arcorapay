# Arcorapay Roadmap

**Updated 2026-06-10.** Arcorapay — an Arcora Labs product — is stablecoin
checkout & settlement on **Arc testnet**, public beta at
[arcorapay.xyz](https://arcorapay.xyz). This is the only forward-looking
planning doc in the repo; the litepaper's roadmap section mirrors it.

One honesty note up front: everything here runs on testnet. No real money
moves, no external audit has happened yet, and mainnet is hard-gated on Arc
Network's own mainnet launch (Circle has signalled a summer-2026 target —
Arc's timeline, not ours to promise) plus the checklist at the bottom.

---

## Shipped

- **v1.0 — Arc-only checkout.** USDC + EURC, Permit2 gas-less settlement,
  hosted checkout, merchant dashboard (SIWE), refunds, treasury reporting,
  `@arcora/sdk` + `@arcora/sdk-react` + WooCommerce plugin published to npm.
- **v1.1 — Custody escrow.** Escrow-per-invoice gateway with a 7-day refund
  window and permissionless claim, admin recovery for abandoned merchants,
  compliance gate (Phase 0, Noop provider on testnet), Vault-backed relayer
  key isolation.
- **v1.2 — Hardening.** Internal-audit remediation closed across the
  off-chain surface: checkout rate limiting, constant-time cron-secret
  comparison, server-side Permit2 signature verification, SSRF + https-only
  guards, invoice input bounds, dependency-audit cleanup, dead-domain default
  fixes.
- **UI v2 redesign (deployed 2026-06-10).** New design system with dual
  light/dark themes, rebranded Arcorapay identity (new wordmark, Hanken
  Grotesk / IBM Plex Mono), landing + checkout + merchant area restyled.
- **Public-beta launch hardening.** Browser-safe publishable keys
  (`pk_` / `ak_` split), terms of service + privacy policy,
  `/api/health` uptime endpoint, ops health-check cron with on-alert runbook,
  and the 2026-06-06 internal full-scope audit sweep — all off-chain findings
  remediated in-repo.

The internal audit passes (2026-05-19, 2026-05-24, 2026-05-31, 2026-06-06)
found nothing exploitable on the deployed V11 gateway bytecode. They did
surface contract-hardening items that need source-level changes; those are
tracked for the next gateway deployment (V12) and ship as one unit with the
next planned redeploy. Until then the shipped off-chain mitigations are the
active surface.

---

## Now

- **Public testnet beta.** Open at [arcorapay.xyz](https://arcorapay.xyz) —
  faucet-funded USDC/EURC, working demo, not a production payment rail.
  Rough edges are tracked in [`KNOWN_ISSUES.md`](../KNOWN_ISSUES.md).
- **Cross-chain v2 demo (in development, feature-flagged).** Customer pays
  USDC from another EVM chain; merchant still settles on Arc. Built against
  Sepolia / Base Sepolia with a CCTP attestation adapter, cross-chain payment
  schema, and a relayer payment state machine. Not enabled in the public
  beta yet.

---

## Next

- **Beta feedback.** Issues, merchant onboarding friction, and checkout
  drop-off reports drive the queue.
- **Observability + failover maturation.** Multi-relayer with rolling
  failover (today: single-instance relayer on one VPS), longer webhook retry
  policy, deeper health/queue metrics on top of the new health-check cron.
- **npm publish of `@arcora/sdk` / `@arcora/sdk-react` 1.2.0.** Both are
  version-synced in-tree; the publish step is pending.
- **Shopify plugin** — same shape as the WooCommerce one.

---

## Gated on Arc mainnet

Triggered by Arc Network mainnet launch *or* first paying merchant *or*
funding round close — whichever comes first. None of these have happened;
every item below is open.

- **External audit RFP** (Spearbit / Cantina / Sherlock). No external audit
  has been performed to date.
- **Multisig admin migration:** `DEFAULT_ADMIN_ROLE` from single EOA to
  2-of-3 or 3-of-5.
- **KYB go-live:** `ManualKybProvider` ($0, testnet pattern) +
  `PersonaProvider` (post-revenue) wired into merchant signup.
- **Vault hardening:** TLS on listener (cert + dedicated host), dedicated
  Unix user for `relayer`/`indexer`/`webhooks`, migration of the relayer key
  to an HSM-isolated signer.
- **Real Chainlink price feeds** — replace mock feeds per stable; oracle
  keepalive timer becomes obsolete.
- **Compliance provider activation** — flip `COMPLIANCE_PROVIDER` from
  `noop` to `elliptic` or `trmlabs`.
- **Populate `packages/contracts/deployments/arc-mainnet.json`** — currently
  a null placeholder with the same shape as `arc-testnet.json`.
- **Bug bounty** — Immunefi engagement with first paying merchant.
- **V12 gateway redeploy** — carries the tracked contract-hardening items
  from the internal audits as one unit. Also the natural vehicle for
  multi-stable expansion (USDT / PYUSD / DAI / USDe), which is
  mainnet-bound — testnet App Kit supports USDC/EURC only.

---

## Forward phases (direction, not commitments)

| Phase | Ships |
|---|---|
| **v2.0** | Cross-chain USDC source via Arc App Kit Bridge (Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, Linea, Codex). Routes through App Kit Bridge, not raw CCTP. Merchant still settles in their chosen Arc stable. The feature-flagged testnet demo above is the first slice. |
| **v2.1** | Source-side aggregator — customer pays in any token on the source chain (native ETH, any ERC-20), via Odos/1inch/0x/Paraswap on each source chain. Reverse route engine computes max-in given target output and slippage. |
| **v2.2** | Non-EVM sources — Solana, Sui. Same product surface, different wallet stack. |
| **v3.0** | Intent / solver model. One-signature one-click; Arcora's solver executes the full route. Multi-month research on ERC-7683, Across, DeBridge-Liquid. Not started until v2.0 and v2.1 are stable. |

---

*Last updated 2026-06-10. Edits go inline; this file is the only
forward-looking planning doc in the repo.*
