import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import {
  TOKEN_MESSENGER_ABI,
  verifySourceBurnTx,
  type SourceReceiptClient,
} from "./receipt";

const payer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const burnToken = "0x5555555555555555555555555555555555555555";
const mintRecipient = `0x${"0".repeat(24)}${"9".repeat(40)}` as const;
const messenger = "0x3333333333333333333333333333333333333333";

interface ClientOverrides {
  from?: `0x${string}`;
  to?: `0x${string}`;
  status?: "success" | "reverted";
  destinationCaller?: `0x${string}`;
  maxFee?: bigint;
  minFinalityThreshold?: number;
}

function client(amount: bigint, overrides: ClientOverrides = {}): SourceReceiptClient {
  return {
    getTransaction: async () => ({
      from: overrides.from ?? payer,
      to: overrides.to ?? messenger,
      input: encodeFunctionData({
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [
          amount,
          30,
          mintRecipient,
          burnToken,
          overrides.destinationCaller ?? `0x${"0".repeat(64)}`,
          overrides.maxFee ?? 0n,
          overrides.minFinalityThreshold ?? 2000,
        ],
      }),
    }),
    getTransactionReceipt: async () => ({
      status: overrides.status ?? "success",
      blockNumber: 123n,
    }),
  };
}

function verify(c: SourceReceiptClient) {
  return verifySourceBurnTx({
    sourceChainId: 84532,
    burnTxHash: `0x${"b".repeat(64)}`,
    expectedPayer: payer,
    expectedAmount: 5_000_000n,
    expectedDestinationDomain: 30,
    expectedMintRecipient: mintRecipient,
    expectedBurnToken: burnToken,
    client: c,
  });
}

describe("verifySourceBurnTx", () => {
  it("accepts a burn fully bound to the stored intent", async () => {
    await expect(verifySourceBurnTx({
      sourceChainId: 84532,
      burnTxHash: `0x${"b".repeat(64)}`,
      expectedPayer: payer,
      expectedAmount: 5_000_000n,
      expectedDestinationDomain: 30,
      expectedMintRecipient: mintRecipient,
      expectedBurnToken: burnToken,
      client: client(5_000_000n),
    })).resolves.toEqual({ ok: true, blockNumber: 123n });
  });

  it("rejects a transaction whose calldata amount differs from the intent", async () => {
    await expect(verifySourceBurnTx({
      sourceChainId: 84532,
      burnTxHash: `0x${"b".repeat(64)}`,
      expectedPayer: payer,
      expectedAmount: 5_000_000n,
      expectedDestinationDomain: 30,
      expectedMintRecipient: mintRecipient,
      expectedBurnToken: burnToken,
      client: client(4_999_999n),
    })).rejects.toThrow("burn_tx_wrong_amount");
  });

  it("rejects a reverted transaction", async () => {
    await expect(verify(client(5_000_000n, { status: "reverted" })))
      .rejects.toThrow("burn_tx_reverted");
  });

  it("rejects a transaction sent to a contract other than the TokenMessenger", async () => {
    await expect(verify(client(5_000_000n, { to: "0x4444444444444444444444444444444444444444" })))
      .rejects.toThrow("burn_tx_wrong_token_messenger");
  });

  it("rejects a transaction from a different payer", async () => {
    await expect(verify(client(5_000_000n, { from: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })))
      .rejects.toThrow("burn_tx_wrong_payer");
  });

  it("rejects a non-open (non-zero) destination caller", async () => {
    await expect(verify(client(5_000_000n, {
      destinationCaller: `0x${"0".repeat(63)}1`,
    }))).rejects.toThrow("burn_tx_wrong_destination_caller");
  });

  it("rejects a non-zero max fee", async () => {
    await expect(verify(client(5_000_000n, { maxFee: 1n })))
      .rejects.toThrow("burn_tx_unexpected_max_fee");
  });

  it("rejects a non-standard finality threshold", async () => {
    await expect(verify(client(5_000_000n, { minFinalityThreshold: 1000 })))
      .rejects.toThrow("burn_tx_wrong_finality_threshold");
  });
});
