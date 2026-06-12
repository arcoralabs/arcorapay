import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { parseChainRegistryJson, planCrosschainRoute } from "@arcora/crosschain-core";

export function enabledSourceChainsFromEnv(): number[] {
  const raw = process.env.CROSSCHAIN_ENABLED_SOURCE_CHAINS ?? "";
  return raw.split(",").map((x) => x.trim()).filter(Boolean).map((x) => Number(x));
}

export function evmAddressToBytes32(address: Address): `0x${string}` {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

export function buildCrosschainIntent(args: {
  invoiceId: string;
  payer: Address;
  sourceChainId: number;
  payoutToken: Address;
  sourceAmountBaseUnits: bigint;
  relayerAddress: Address;
}) {
  const registryJson = process.env.CROSSCHAIN_CHAIN_CONFIG_JSON;
  if (!registryJson) throw new Error("CROSSCHAIN_CHAIN_CONFIG_JSON missing");
  const route = planCrosschainRoute({
    registry: parseChainRegistryJson(registryJson),
    sourceChainId: args.sourceChainId,
    destinationChainId: 5_042_002,
    sourceAmountBaseUnits: args.sourceAmountBaseUnits,
    payoutToken: args.payoutToken,
    enabledSourceChains: enabledSourceChainsFromEnv(),
  });

  return {
    idempotencyKey: `cc_${args.invoiceId}_${args.payer.toLowerCase()}_${args.sourceChainId}`,
    routeVersion: "crosschain-v2-q1",
    sourceAmountBaseUnits: args.sourceAmountBaseUnits,
    mintRecipient: evmAddressToBytes32(args.relayerAddress),
    destinationDomain: route.destination.cctpDomain,
    destinationChainId: route.destination.chainId,
    destinationToken: route.destination.tokens.USDC.address,
    intentNonce: randomUUID(),
    route,
  };
}
