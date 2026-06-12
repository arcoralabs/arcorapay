import {
  createPublicClient,
  decodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { chainById, parseChainRegistryJson } from "@arcora/crosschain-core";

/**
 * Minimal read surface over a viem public client so tests can inject a fake
 * source-chain client without spinning up an RPC.
 */
export interface SourceReceiptClient {
  getTransaction(args: { hash: Hex }): Promise<{
    from: Address;
    to: Address | null;
    input: Hex;
  }>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
  }>;
}

export const TOKEN_MESSENGER_ABI = parseAbi([
  "function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold)",
]);

/**
 * Verifies that a customer-submitted source-chain burn transaction is bound
 * byte-for-byte to the stored intent: the tx must have succeeded, target the
 * registry's TokenMessenger for the source chain, originate from the intent's
 * payer, and carry depositForBurn calldata matching the intent's amount,
 * destination domain, mint recipient, and burn token exactly — plus the fixed
 * protocol parameters the prepare route quoted (open destination caller, zero
 * max fee, standard finality threshold). Any mismatch throws a stable
 * `burn_tx_*` error code; nothing about the intent row is touched here.
 */
export async function verifySourceBurnTx(args: {
  sourceChainId: number;
  burnTxHash: Hex;
  expectedPayer: string;
  expectedAmount: bigint;
  expectedDestinationDomain: number;
  expectedMintRecipient: Hex;
  expectedBurnToken: Address;
  client?: SourceReceiptClient;
}): Promise<{ ok: true; blockNumber: bigint }> {
  const registryJson = process.env.CROSSCHAIN_CHAIN_CONFIG_JSON;
  if (!registryJson) throw new Error("CROSSCHAIN_CHAIN_CONFIG_JSON missing");
  const chain = chainById(parseChainRegistryJson(registryJson), args.sourceChainId);
  const rpc = process.env[chain.rpcEnv];
  if (!rpc) throw new Error(`missing_rpc:${chain.rpcEnv}`);
  const client: SourceReceiptClient = args.client
    ?? createPublicClient({ transport: http(rpc) }) as unknown as SourceReceiptClient;

  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: args.burnTxHash }),
    client.getTransactionReceipt({ hash: args.burnTxHash }),
  ]);

  if (receipt.status !== "success") throw new Error("burn_tx_reverted");
  if (tx.to?.toLowerCase() !== chain.tokenMessenger.toLowerCase()) {
    throw new Error("burn_tx_wrong_token_messenger");
  }
  if (tx.from.toLowerCase() !== args.expectedPayer.toLowerCase()) {
    throw new Error("burn_tx_wrong_payer");
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: TOKEN_MESSENGER_ABI,
      data: tx.input,
    });
  } catch {
    throw new Error("burn_tx_invalid_calldata");
  }
  if (decoded.functionName !== "depositForBurn") {
    throw new Error("burn_tx_wrong_function");
  }

  const [
    amount,
    destinationDomain,
    mintRecipient,
    burnToken,
    destinationCaller,
    maxFee,
    minFinalityThreshold,
  ] = decoded.args;

  if (amount !== args.expectedAmount) throw new Error("burn_tx_wrong_amount");
  if (destinationDomain !== args.expectedDestinationDomain) throw new Error("burn_tx_wrong_destination_domain");
  if (mintRecipient.toLowerCase() !== args.expectedMintRecipient.toLowerCase()) {
    throw new Error("burn_tx_wrong_mint_recipient");
  }
  if (burnToken.toLowerCase() !== args.expectedBurnToken.toLowerCase()) {
    throw new Error("burn_tx_wrong_burn_token");
  }
  if (destinationCaller !== `0x${"0".repeat(64)}`) throw new Error("burn_tx_wrong_destination_caller");
  if (maxFee !== 0n) throw new Error("burn_tx_unexpected_max_fee");
  if (minFinalityThreshold !== 2000) throw new Error("burn_tx_wrong_finality_threshold");

  return { ok: true, blockNumber: receipt.blockNumber };
}
