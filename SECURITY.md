# Security policy

Arcorapay is a stablecoin checkout protocol. We take security findings seriously and try to be a fair counterparty for researchers.

## Reporting a vulnerability

Report privately through **[GitHub Security Advisories](https://github.com/arcoralabs/arcorapay/security/advisories/new)** on the [arcoralabs/arcorapay](https://github.com/arcoralabs/arcorapay) repo — it keeps the report private and threaded until we've coordinated a fix. Include:

- Affected contract / endpoint / commit
- Reproduction steps (PoC code or transaction trace welcome)
- Severity assessment in your own words
- Whether you've shared this with anyone else

For sensitive material you'd rather not put in a GitHub advisory, request our PGP key via an issue and we'll arrange an encrypted channel.

Internal audit reports are available to partners on request.

We aim to:

- Acknowledge within **24 hours**
- Triage with severity within **3 business days**
- Patch + disclose on a coordinated timeline (typically 30 days for medium/high, faster for critical)

Please do **not** open a public GitHub issue or social-media post until we've had a chance to respond. Coordinated disclosure protects users.

## Scope

The canonical, in-audit-scope on-chain surface is `packages/contracts/src/ArcFXGateway.sol` (the version-neutral custody-escrow gateway) and the OpenZeppelin libraries it imports.

Off-chain components (Vercel app, Supabase Postgres, VPS relayer/indexer/webhooks, hosted checkout, dashboard, SDK) are also in scope for security reports; severity is graded on real-world impact, not contract LOC.

Out of scope:

- Pre-retirement gateway deployments (≤ v1.1) — retired 2026-05-20, not deployed in canonical traffic and kept in git history only.
- Third-party services we depend on (Circle USDC/EURC, Permit2, App Kit Swap, Vercel, Supabase). Report those upstream.
- Social engineering against Arcora team or merchants.
- Best-practice findings without a concrete attack scenario (style, gas micro-optimisations, "could be more efficient").

## Severity → reward

Until a live bug bounty exists (planned via Immunefi at mainnet T-0), reports are credited with:

- **Critical** (drained funds, sanctions bypass with on-chain settlement, RCE on relayer) — case-by-case bounty + public credit + early collaboration on remediation.
- **High** (admin role takeover, fee accounting break, replay across invoices) — public credit + meaningful bounty within reasonable budget.
- **Medium / Low** — public credit on the security acknowledgments page (when one exists), retro thanks via email.

We are pre-revenue, so cash bounties scale with the report's severity and our ability to pay. Our intent is to be honest about budget rather than promise a sticker price we can't deliver.

## Acknowledgments

When we have findings to credit, we'll list them here:

- _none yet — this section will populate as reports are triaged_

## Roadmap to a live bounty

A formal Immunefi program with severity-tiered cash pool is planned for **mainnet T-0** alongside the first paying merchant. Until then, this disclosure channel is the canonical path.
