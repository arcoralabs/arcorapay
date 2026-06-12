import { createPublicClient, createWalletClient, http, defineChain, type Address } from "viem";
import { loadServerWallet } from "@/lib/wallet/server-wallet";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network"] },
  },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

export async function getServerWalletClient() {
  const account = await loadServerWallet();
  return createWalletClient({ account, chain: arcTestnet, transport: http() });
}

export const POOL: Address = (process.env.POOL_ADDRESS ?? "0x0000000000000000000000000000000000000000") as Address;

// Active custody-escrow gateway address. Source is `packages/contracts/src/
// ArcFXGateway.sol`; the live deployment is recorded in
// `packages/contracts/deployments/arc-testnet.json` and exposed via
// `GATEWAY_ADDRESS` in every environment. Retired pre-V11 addresses are
// kept in git history only — testnet was wiped 2026-05-20.
export const GATEWAY_ADDRESS: Address =
  (process.env.GATEWAY_ADDRESS
    ?? "0x0000000000000000000000000000000000000000") as Address;

// Keep GATEWAY alias for call sites that haven't migrated yet.
export const GATEWAY = GATEWAY_ADDRESS;
