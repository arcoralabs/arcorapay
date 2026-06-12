# Cross-Chain v2 Demo Runbook

## Goal

Demonstrate Base Sepolia or Ethereum Sepolia USDC payment into Arc Testnet,
followed by Arc-side settlement into the merchant payout token.

## Preconditions

- Arcora app deployed with `NEXT_PUBLIC_CROSSCHAIN_ENABLED=true`.
- Relayer deployed with `CROSSCHAIN_ENABLED=true`.
- `CROSSCHAIN_ENABLED_SOURCE_CHAINS=84532,11155111`.
- `CROSSCHAIN_CHAIN_CONFIG_JSON` contains verified non-zero CCTP domains,
  TokenMessenger addresses, MessageTransmitter addresses, and USDC addresses
  for Arc Testnet, Base Sepolia, and Ethereum Sepolia.
- Source-chain RPC envs are configured.
- `CCTP_IRIS_API_URL=https://iris-api-sandbox.circle.com`.
- `NEXT_PUBLIC_RELAYER_ADDRESS` on the app deployment MUST equal the relayer's
  signing address (Vault key); set it on the relayer too so the daemon can
  fail fast on mismatch.
- Relayer wallet has Arc gas balance and can call `receiveMessage`.
- Customer wallet has source-chain USDC and gas.

## Demo Steps

1. Merchant creates an invoice from `/m/dashboard`.
2. Customer opens `/i/<invoiceId>`.
3. Customer selects Base Sepolia or Ethereum Sepolia.
4. Customer clicks `Bridge USDC from <chain>`.
5. Wallet sends `depositForBurn` to the source TokenMessenger.
6. App submits the burn tx hash to `/api/checkout/crosschain/submit`.
7. Relayer polls IRIS for attestation.
8. Relayer calls Arc `receiveMessage`.
9. Relayer swaps Arc USDC to merchant payout token when payout is not USDC.
10. Relayer calls `settleInvoice`.
11. Checkout status becomes `paid`.

## Verification Commands

```bash
pnpm --filter @arcora/crosschain-core test
pnpm --filter @arcora/app test app/api/checkout/crosschain/prepare/route.test.ts
pnpm --filter @arcora/app test app/api/checkout/crosschain/submit/route.test.ts
pnpm --filter arcora-relayer test cctp.test.ts crosschain-worker.test.ts arc-settlement.test.ts
pnpm --filter arcora-relayer smoke:crosschain
```

## Failure Interpretation

- `source_chain_disabled`: source chain is not enabled in `CROSSCHAIN_ENABLED_SOURCE_CHAINS`.
- `burn_tx_wrong_token_messenger`: submitted burn tx did not target the configured CCTP TokenMessenger.
- `burn_tx_already_used`: this burn transaction is already bound to another payment intent.
- `iris_request_failed:<status>`: Circle IRIS returned an unexpected HTTP status.
- `attestation_deadline_exceeded`: no attestation within `CROSSCHAIN_ATTESTATION_DEADLINE_MS` (default 2h); the row is terminal `bridge_failed` for operator recovery.
- `payout shortfall`: bridge/swap delivered less than `amountOutMin`; do not settle.
- `settle_failed`: operator must inspect `crosschain_payments.last_error`.

## Refund Policy

- If Arc receives less USDC than `amountOutMin` and no Arc swap has occurred, the relayer transfers the received Arc USDC to the payer's same EVM address and marks the payment `refunded`.
- The UI must state that this Q1 automatic refund is delivered on Arc, not the original source chain.
- Once an Arc USDC-to-EURC swap has executed, automatic refund is disabled. Operators recover from the recorded bridge, swap, and settlement transaction hashes to avoid an unsafe or lossy implicit reverse route.
- A burn awaiting Circle attestation is retried, not refunded or marked failed merely because IRIS is slow. Attestation polls do not consume the retry budget; only the wall-clock deadline bounds them.

## Customer Recovery Notes

- If the customer's burn succeeded but submission failed, the checkout stores a local resume record and offers "Resume payment" — it must not prompt a second burn.
- A poll timeout in the UI shows "still processing"; the payment continues server-side and the invoice page flips to paid when settled.
