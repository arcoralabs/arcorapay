import { ArcoraError } from "./error";

/**
 * Permit2 typed-data builder for Arcora's v0.8 (relayer-driven) settlement.
 * The customer signs a `PermitWitnessTransferFrom` message authorising a
 * specific relayer to pull `amount` of `payInToken`, with a witness that
 * binds the signature to the invoice — replaying the same signature against
 * a different invoice or relayer fails on-chain.
 *
 * The output is plain EIP-712 typed-data — pass it to `signTypedData` on
 * any wallet (viem, ethers, MetaMask provider, WalletConnect, etc.).
 *
 * Usage:
 *   const td = buildArcoraSwapIntent({
 *     chainId, payInToken, amount, relayer, invoiceId,
 *     deadline: Math.floor(Date.now() / 1000) + 300,
 *     nonce:    randomBigInt(),
 *   });
 *   const signature = await wallet.signTypedData(td);
 *   await fetch("/api/checkout/submit", { method: "POST", body: JSON.stringify({
 *     invoiceId, payer, payInToken, amountIn: amount.toString(),
 *     permit2Data:      td.witnessForBackend,
 *     permit2Signature: signature,
 *   })});
 */

// Permit2 deploys to the same address on every chain (CREATE2-deterministic).
// Override only if a chain has a non-canonical instance.
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

// The witness type. Keeping it minimal: just (invoiceId, relayer). On-chain
// the gateway re-derives the witness hash from these two fields and matches
// against what the customer signed.
const ARCORA_SWAP_INTENT_TYPE = "ArcoraSwapIntent(bytes32 invoiceId,address relayer)";

// Permit2 builds the full type string by concatenating the witness type with
// `TokenPermissions`. The exact ordering matters — Permit2 demands witness
// definitions sorted alphabetically among themselves but TokenPermissions
// always comes last in the concatenation.
const WITNESS_TYPE_STRING =
  `ArcoraSwapIntent witness)ArcoraSwapIntent(bytes32 invoiceId,address relayer)TokenPermissions(address token,uint256 amount)`;

export interface BuildArcoraSwapIntentParams {
  /** Chain id (Arc Testnet = 5042002, Arc Mainnet TBD). */
  chainId:    number;
  /** Token the customer is paying in (USDC, EURC, …). 0x-address. */
  payInToken: `0x${string}`;
  /** Amount in base units of `payInToken` (e.g. 200000n for 0.20 USDC). */
  amount:     bigint;
  /** Relayer wallet authorised to pull funds. 0x-address. */
  relayer:    `0x${string}`;
  /** Invoice global id (32 bytes hex). */
  invoiceId:  `0x${string}`;
  /** Unix timestamp (seconds) after which the signature is invalid. */
  deadline:   bigint;
  /** Permit2 nonce — any unused 256-bit value. */
  nonce:      bigint;
  /** Optional override for the Permit2 contract address. */
  permit2Address?: `0x${string}`;
}

/**
 * Returns:
 *   - `typedData`: pass directly to `wallet.signTypedData(typedData)` (viem).
 *   - `witnessForBackend`: the `permit2Data` shape your /api/checkout/submit
 *     route expects (nonce, deadline, witness hash, witnessTypeString).
 *
 * The `witness` field in `witnessForBackend` is what the gateway will
 * recompute on-chain; the SDK does NOT compute the witness hash — the
 * relayer does it before calling `Permit2.permitWitnessTransferFrom`. We
 * just record the witness components so the relayer can derive it.
 */
export function buildArcoraSwapIntent(params: BuildArcoraSwapIntentParams): {
  typedData: {
    domain:      { name: "Permit2"; chainId: number; verifyingContract: `0x${string}` };
    types: {
      TokenPermissions:           [{ name: "token";  type: "address" }, { name: "amount"; type: "uint256" }];
      ArcoraSwapIntent:           [{ name: "invoiceId"; type: "bytes32" }, { name: "relayer"; type: "address" }];
      PermitWitnessTransferFrom:  [
        { name: "permitted"; type: "TokenPermissions" },
        { name: "spender";   type: "address" },
        { name: "nonce";     type: "uint256" },
        { name: "deadline";  type: "uint256" },
        { name: "witness";   type: "ArcoraSwapIntent" },
      ];
    };
    primaryType: "PermitWitnessTransferFrom";
    message: {
      permitted: { token: `0x${string}`; amount: bigint };
      spender:   `0x${string}`;
      nonce:     bigint;
      deadline:  bigint;
      witness:   { invoiceId: `0x${string}`; relayer: `0x${string}` };
    };
  };
  witnessForBackend: {
    nonce:             string;
    deadline:          string;
    witnessTypeString: string;
    /** Backend re-derives the witness hash from invoiceId + relayer; this
     *  field is here so the backend can verify it matches what was signed. */
    witnessComponents: { invoiceId: `0x${string}`; relayer: `0x${string}` };
  };
} {
  const verifyingContract = (params.permit2Address ?? PERMIT2_ADDRESS) as `0x${string}`;
  return {
    typedData: {
      domain: { name: "Permit2", chainId: params.chainId, verifyingContract },
      types: {
        TokenPermissions: [
          { name: "token",  type: "address" },
          { name: "amount", type: "uint256" },
        ],
        ArcoraSwapIntent: [
          { name: "invoiceId", type: "bytes32" },
          { name: "relayer",   type: "address" },
        ],
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender",   type: "address" },
          { name: "nonce",     type: "uint256" },
          { name: "deadline",  type: "uint256" },
          { name: "witness",   type: "ArcoraSwapIntent" },
        ],
      },
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: params.payInToken, amount: params.amount },
        spender:   params.relayer,
        nonce:     params.nonce,
        deadline:  params.deadline,
        witness:   { invoiceId: params.invoiceId, relayer: params.relayer },
      },
    },
    witnessForBackend: {
      nonce:             params.nonce.toString(),
      deadline:          params.deadline.toString(),
      witnessTypeString: WITNESS_TYPE_STRING,
      witnessComponents: { invoiceId: params.invoiceId, relayer: params.relayer },
    },
  };
}

/**
 * Cryptographically random 256-bit nonce. Browser-safe — requires
 * `globalThis.crypto.getRandomValues` (any modern browser, Node ≥ 19, Bun,
 * Deno, Edge runtimes).
 *
 * Throws `ArcoraError("NO_SECURE_RANDOM")` if no secure RNG is available.
 * We deliberately refuse to fall back to `Math.random`: a Permit2 nonce
 * collision allows signature replay, which (combined with a leaked or
 * resigned signature) could double-spend funds. Predictable nonces are not
 * acceptable in any environment that handles real value.
 */
export function randomNonce(): bigint {
  const g = globalThis.crypto as Crypto | undefined;
  if (!g || typeof g.getRandomValues !== "function") {
    throw new ArcoraError(
      "NO_SECURE_RANDOM",
      "Secure random unavailable — refusing to use Math.random for permit2 nonce. Upgrade Node ≥ 19 or polyfill globalThis.crypto.",
    );
  }
  const bytes = new Uint8Array(32);
  g.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}
