import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { verifyPermit2Signature, ARC_TESTNET_CHAIN_ID } from "./permit2-verify";
import { PERMIT2_ADDRESS } from "./permit2";

const PK = ("0x" + "11".repeat(32)) as Hex;
const account = privateKeyToAccount(PK);

const TYPES = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  ArcoraSwapIntent: [
    { name: "invoiceId", type: "bytes32" },
    { name: "relayer", type: "address" },
  ],
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "ArcoraSwapIntent" },
  ],
} as const;

const params = {
  chainId: ARC_TESTNET_CHAIN_ID,
  invoiceId: ("0x" + "ab".repeat(32)) as Hex,
  payer: account.address as Address,
  payInToken: "0x3333333333333333333333333333333333333333" as Address,
  amountIn: 1_000_000n,
  relayer: "0x4444444444444444444444444444444444444444" as Address,
  nonce: 7n,
  deadline: 9_999_999_999n,
};

async function sign(p: typeof params): Promise<Hex> {
  return account.signTypedData({
    domain: { name: "Permit2", chainId: p.chainId, verifyingContract: PERMIT2_ADDRESS },
    types: TYPES,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: p.payInToken, amount: p.amountIn },
      spender: p.relayer,
      nonce: p.nonce,
      deadline: p.deadline,
      witness: { invoiceId: p.invoiceId, relayer: p.relayer },
    },
  });
}

describe("verifyPermit2Signature", () => {
  it("accepts a signature from the claimed payer", async () => {
    const signature = await sign(params);
    expect(await verifyPermit2Signature({ ...params, signature })).toBe(true);
  });

  it("rejects when amountIn is tampered after signing", async () => {
    const signature = await sign(params);
    expect(await verifyPermit2Signature({ ...params, amountIn: 999n, signature })).toBe(false);
  });

  it("rejects when the relayer is swapped", async () => {
    const signature = await sign(params);
    const other = "0x5555555555555555555555555555555555555555" as Address;
    expect(await verifyPermit2Signature({ ...params, relayer: other, signature })).toBe(false);
  });

  it("rejects when the invoice id is swapped", async () => {
    const signature = await sign(params);
    const other = ("0x" + "cd".repeat(32)) as Hex;
    expect(await verifyPermit2Signature({ ...params, invoiceId: other, signature })).toBe(false);
  });

  it("rejects when the recovered signer is not the claimed payer", async () => {
    const signature = await sign(params);
    const impostor = "0x6666666666666666666666666666666666666666" as Address;
    expect(await verifyPermit2Signature({ ...params, payer: impostor, signature })).toBe(false);
  });

  it("rejects when the nonce is tampered", async () => {
    const signature = await sign(params);
    expect(await verifyPermit2Signature({ ...params, nonce: 8n, signature })).toBe(false);
  });
});
