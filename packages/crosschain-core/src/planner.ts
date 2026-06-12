import type { Address } from "viem";
import { chainById, type ChainRegistry, type CctpChainConfig, type TokenConfig } from "./chains";

export interface PlannedCrosschainRoute {
  source: CctpChainConfig;
  destination: CctpChainConfig;
  sourceToken: TokenConfig;
  destinationToken: TokenConfig;
  sourceAmountBaseUnits: bigint;
  mintRecipientChain: "arc-testnet";
  requiresArcSwap: boolean;
  /**
   * Describes the Arc swap leg of this route.
   *
   * IMPORTANT: consumers MUST gate on `requiresArcSwap` before acting on this field.
   * For USDC→USDC routes `requiresArcSwap` is `false` and this field describes a no-op
   * (tokenIn === tokenOut === "USDC") — it MUST NOT be executed in that case.
   */
  arcSwap: { tokenIn: "USDC"; tokenOut: "USDC" | "EURC" };
}

export function planCrosschainRoute(args: {
  registry: ChainRegistry;
  sourceChainId: number;
  destinationChainId: number;
  sourceAmountBaseUnits: bigint;
  payoutToken: Address;
  enabledSourceChains: readonly number[];
}): PlannedCrosschainRoute {
  const destination = chainById(args.registry, args.destinationChainId);
  if (destination.key !== "arc-testnet") throw new Error(`unsupported destination chain: ${args.destinationChainId}`);
  if (!args.enabledSourceChains.includes(args.sourceChainId)) {
    throw new Error(`source chain disabled: ${args.sourceChainId}`);
  }
  if (args.sourceAmountBaseUnits <= 0n) {
    throw new Error("source amount must be positive");
  }

  const source = chainById(args.registry, args.sourceChainId);
  const payout = args.payoutToken.toLowerCase();
  const usdc = destination.tokens.USDC;
  const eurc = destination.tokens.EURC;
  if (!eurc) throw new Error("Arc EURC config missing");

  const destinationToken =
    payout === usdc.address.toLowerCase() ? usdc :
    payout === eurc.address.toLowerCase() ? eurc :
    null;
  if (!destinationToken) throw new Error(`unsupported Arc payout token: ${args.payoutToken}`);

  return {
    source,
    destination,
    sourceToken: source.tokens.USDC,
    destinationToken,
    sourceAmountBaseUnits: args.sourceAmountBaseUnits,
    mintRecipientChain: "arc-testnet",
    requiresArcSwap: destinationToken.symbol !== "USDC",
    arcSwap: { tokenIn: "USDC", tokenOut: destinationToken.symbol },
  };
}
