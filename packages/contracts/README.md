# @arcora/contracts — ArcFXGateway

Solidity contracts powering **Arcorapay**, a Stripe-shaped stablecoin checkout settling on [Arc Network](https://arc.network). The customer signs **one** EIP-712 (Permit2) message; an off-chain Arcorapay relayer pulls the pay-in, runs Circle App Kit Swap to convert it, and calls the gateway to deliver the merchant's preferred stablecoin payout into a per-invoice custody escrow.

## Audit scope

The canonical, in-scope contract is **`src/ArcFXGateway.sol`** plus the OpenZeppelin libraries it imports. The source is **version-neutral** — there is no `V8`/`V11` suffix on the file. Deployment lineage is tracked by on-chain *address*, not by filename: a new deployment with different bytecode lands at a new address recorded in [`deployments/arc-testnet.json`](./deployments/arc-testnet.json). The only other source file is `src/testnet/MintableERC20.sol` (a faucet token used on testnet only).

## Architecture in one diagram

```
                              ┌──────────────────────────────┐
   ┌────────────────┐         │ Arcorapay relayer (off-chain)│
   │ Customer EOA   │         │ ops/relayer/run.ts (VPS)     │
   │ signs Permit2  │────────▶│  ─ Permit2.permitTransferFrom│
   └────────────────┘         │  ─ kit.swap (App Kit Swap)   │
                              │  ─ settleInvoice             │
                              └─────┬────────────────────────┘
                                    │ (msg.sender = relayer)
                                    ▼
                              ┌─────────────────────────────────┐
                              │  ArcFXGateway                   │
                              │   ─ supportedTokens (whitelist) │
                              │   ─ merchants                   │
                              │   ─ invoices  (Created → ...)   │
                              │   ─ escrows   (per-invoice hold)│
                              │   ─ AccessControl: ADMIN/RELAYER│
                              │   ─ Pausable / ReentrancyGuard  │
                              └─────────────┬───────────────────┘
                                            │ claim() after 7d → safeTransfer
                                            ▼
                              ┌────────────────┐
                              │ Merchant payout│
                              └────────────────┘
```

The gateway never holds the pay-in token. App Kit Swap is the only swap surface, and it runs entirely off-chain via the relayer's signed RFQ flow against Circle's maker network. Settled funds sit in per-invoice escrow inside the contract for a 7-day refund window before they can be claimed to the merchant.

## Build & test

```bash
# from repo root
pnpm install

# from packages/contracts
forge build --sizes
forge test                        # 77 tests (unit + reentrancy + fuzz/invariant)
forge coverage --report summary   # see "Coverage" below
bin/coverage-gate.sh lcov.info    # threshold gate (CI Layer 2)
```

The suite lives under `test/gateway/` (Constructor, Settle, Claim, Refund, PayerRefund, Fees, Merchant, Delegate, Pause, AdminRecovery, Reentrancy, AuditCoverage).

### Coverage

Coverage gates run in CI against `src/ArcFXGateway.sol`:

| Metric | Floor (CI gate) |
|---|---|
| Lines     | 95% |
| Branches  | 90% |

The floor sits at the audit-ready bar so regressions below the bar fail CI immediately. See [`bin/coverage-gate.sh`](./bin/coverage-gate.sh) for the exact thresholds enforced.

### Static analysis

- **Slither** runs on every push and PR (`fail-on: medium`, paths `lib/` and `test/` filtered). Triage exceptions live in [`.slither-triage.md`](./.slither-triage.md).
- **Mythril** runs on push (skipped on PR for speed), 30-min timeout, gateway only.

CI definition: [`.github/workflows/contracts-ci.yml`](../../.github/workflows/contracts-ci.yml).

## Deploy

Use [`script/Deploy.s.sol`](./script/Deploy.s.sol). On Arc testnet, `forge script --broadcast` has been observed reporting success for a tx that never confirmed — always verify with `cast receipt` (status=1) **and** `cast code <addr>` (non-empty) before trusting the broadcast file.

Required env vars:

| Var | Purpose |
|-----|---------|
| `DEPLOYER_PRIVATE_KEY` | EOA used for broadcast (uint256 hex) |
| `GATEWAY_OWNER` | Address granted `DEFAULT_ADMIN_ROLE` |
| `GATEWAY_RELAYER` | Address granted `RELAYER_ROLE` (Vault-derived) |
| `PROTOCOL_FEE_BPS` | Fee in basis points (≤ 1000, locked in constructor; production = 30 = 0.30%) |
| `REFUND_WINDOW_SECONDS` | Refund window (typ. 604800 = 7 days) |
| `ADMIN_RECOVERY_DELAY` | Delay before deactivated-merchant escrow is admin-recoverable (typ. 604800) |
| `SUPPORTED_TOKENS` | *(optional)* comma-separated token addresses to whitelist at deploy. Whitelisting only runs when `deployer == GATEWAY_OWNER`; otherwise the script logs a loud WARN and you call `setTokenSupport` from the owner address separately (audit #26). |

After deploy, update the gateway address in Vercel + the VPS relayer/indexer env files, then record the new address in `deployments/arc-testnet.json`.

## Live testnet deployment

| Contract | Address | Status |
|---|---|---|
| ArcFXGateway | [`0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3`](https://testnet.arcscan.app/address/0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3) | live, canonical — custody-escrow gateway, deployed 2026-05-13 (audit-fixed bytecode) |
| Permit2 | [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://testnet.arcscan.app/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) | Uniswap universal Permit2 |
| FxEscrow (App Kit Swap settlement) | [`0x867650F5eAe8df91445971f14d89fd84F0C9a9f8`](https://testnet.arcscan.app/address/0x867650F5eAe8df91445971f14d89fd84F0C9a9f8) | Circle-managed |
| USDC | `0x3600000000000000000000000000000000000000` | Circle-managed canonical |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | Circle-managed canonical |

[`deployments/arc-testnet.json`](./deployments/arc-testnet.json) is the canonical machine-readable record. Pre-retirement deployments (≤ v1.1) were retired on 2026-05-20 (testnet wiped) and remain only in git history.

## Reporting a finding

See the repo-root [`SECURITY.md`](../../SECURITY.md). Short version: open a [GitHub security advisory or issue](https://github.com/arcoralabs/arcorapay/issues); we aim to acknowledge within 24 hours. A live Immunefi bug bounty replaces this channel at mainnet T-0.

## License

MIT — `src/ArcFXGateway.sol`, scripts, and tests.
