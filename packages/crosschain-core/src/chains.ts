import type { Address } from "viem";

export type ChainKey =
  | "arc-testnet"
  | "base-sepolia"
  | "ethereum-sepolia"
  | "arbitrum-sepolia"
  | "optimism-sepolia"
  | "polygon-amoy"
  | "avalanche-fuji"
  | "linea-sepolia";

export interface TokenConfig {
  symbol: "USDC" | "EURC";
  address: Address;
  decimals: number;
}

export interface CctpChainConfig {
  key: ChainKey;
  label: string;
  chainId: number;
  cctpDomain: number;
  rpcEnv: string;
  tokenMessenger: Address;
  messageTransmitter: Address;
  tokens: {
    USDC: TokenConfig;
    EURC?: TokenConfig;
  };
}

const STATIC_CHAINS: Record<ChainKey, Pick<CctpChainConfig, "key" | "label" | "chainId" | "rpcEnv">> = {
  "arc-testnet": { key: "arc-testnet", label: "Arc Testnet", chainId: 5_042_002, rpcEnv: "ARC_TESTNET_RPC" },
  "base-sepolia": { key: "base-sepolia", label: "Base Sepolia", chainId: 84_532, rpcEnv: "BASE_SEPOLIA_RPC" },
  "ethereum-sepolia": { key: "ethereum-sepolia", label: "Ethereum Sepolia", chainId: 11_155_111, rpcEnv: "ETHEREUM_SEPOLIA_RPC" },
  "arbitrum-sepolia": { key: "arbitrum-sepolia", label: "Arbitrum Sepolia", chainId: 421_614, rpcEnv: "ARBITRUM_SEPOLIA_RPC" },
  "optimism-sepolia": { key: "optimism-sepolia", label: "Optimism Sepolia", chainId: 11_155_420, rpcEnv: "OPTIMISM_SEPOLIA_RPC" },
  "polygon-amoy": { key: "polygon-amoy", label: "Polygon Amoy", chainId: 80_002, rpcEnv: "POLYGON_AMOY_RPC" },
  "avalanche-fuji": { key: "avalanche-fuji", label: "Avalanche Fuji", chainId: 43_113, rpcEnv: "AVALANCHE_FUJI_RPC" },
  "linea-sepolia": { key: "linea-sepolia", label: "Linea Sepolia", chainId: 59_141, rpcEnv: "LINEA_SEPOLIA_RPC" },
};

export type ChainRegistry = ReadonlyMap<number, CctpChainConfig>;

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`invalid non-zero address for ${field}`);
  }
  return value as Address;
}

export function parseChainRegistryJson(raw: string): ChainRegistry {
  const parsed = JSON.parse(raw) as Record<string, {
    cctpDomain: number;
    tokenMessenger: string;
    messageTransmitter: string;
    usdcAddress: string;
    eurcAddress?: string;
  }>;
  const entries: [number, CctpChainConfig][] = [];

  for (const [rawKey, runtime] of Object.entries(parsed)) {
    const key = rawKey as ChainKey;
    const staticConfig = STATIC_CHAINS[key];
    if (!staticConfig) throw new Error(`unknown chain config key: ${rawKey}`);
    if (!Number.isInteger(runtime.cctpDomain) || runtime.cctpDomain < 0) {
      throw new Error(`invalid cctpDomain for ${rawKey}`);
    }
    entries.push([staticConfig.chainId, {
      ...staticConfig,
      cctpDomain: runtime.cctpDomain,
      tokenMessenger: address(runtime.tokenMessenger, `${rawKey}.tokenMessenger`),
      messageTransmitter: address(runtime.messageTransmitter, `${rawKey}.messageTransmitter`),
      tokens: {
        USDC: { symbol: "USDC", address: address(runtime.usdcAddress, `${rawKey}.usdcAddress`), decimals: 6 },
        ...(runtime.eurcAddress
          ? { EURC: { symbol: "EURC" as const, address: address(runtime.eurcAddress, `${rawKey}.eurcAddress`), decimals: 6 } }
          : {}),
      },
    }]);
  }
  return new Map(entries);
}

export function chainById(registry: ChainRegistry, chainId: number): CctpChainConfig {
  const chain = registry.get(chainId);
  if (!chain) throw new Error(`unsupported source chain: ${chainId}`);
  return chain;
}
