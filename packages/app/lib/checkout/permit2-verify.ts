import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { PERMIT2_ADDRESS } from "./permit2";

/**
 * Server-side Permit2 EIP-712 verification — closes the audit pass 1 #1
 * gap where /api/checkout/submit accepted any signature with the right
 * shape and let the relayer discover the failure on-chain (gas burn).
 *
 * We reconstruct the exact PermitWitnessTransferFrom typed-data the
 * client SDK produced from the bound parameters (chain id, our relayer,
 * invoice id, token, amount, nonce, deadline) and recover the signer.
 * If the recovered address doesn't match the claimed payer, we reject
 * before the row reaches the queue.
 *
 * The witness components (invoiceId + relayer) are NOT trusted from the
 * request body — they're rebuilt server-side. The relayer address is
 * the configured server wallet, the invoice id is what the route was
 * called with. So a forged signature can't fake either.
 */

export const ARC_TESTNET_CHAIN_ID = 5042002;

const TYPES = {
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
} as const;

export interface VerifyParams {
  chainId:    number;
  invoiceId:  Hex;
  payer:      Address;
  payInToken: Address;
  amountIn:   bigint;
  relayer:    Address;
  nonce:      bigint;
  deadline:   bigint;
  signature:  Hex;
}

/** Returns true iff the signature recovers to `params.payer`. */
export async function verifyPermit2Signature(params: VerifyParams): Promise<boolean> {
  const recovered = await recoverTypedDataAddress({
    domain: {
      name:              "Permit2",
      chainId:           params.chainId,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types:       TYPES,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: params.payInToken, amount: params.amountIn },
      spender:   params.relayer,
      nonce:     params.nonce,
      deadline:  params.deadline,
      witness:   { invoiceId: params.invoiceId, relayer: params.relayer },
    },
    signature: params.signature,
  });
  return recovered.toLowerCase() === params.payer.toLowerCase();
}
