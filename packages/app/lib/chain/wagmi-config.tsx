"use client";

import { createConfig, createStorage, http, noopStorage, WagmiProvider } from "wagmi";
import { defineChain } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThirdwebProvider } from "thirdweb/react";
import { injected, walletConnect } from "wagmi/connectors";
import { useState, type PropsWithChildren } from "react";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network"] },
  },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

export const wagmiConfig = createConfig({
  // Base Sepolia + Ethereum Sepolia are the cross-chain checkout source
  // chains (CCTP depositForBurn happens there; settlement stays on Arc).
  chains: [arcTestnet, baseSepolia, sepolia],
  connectors: [
    injected(),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
      showQrModal: true,
    }),
  ],
  transports: {
    [arcTestnet.id]: http(),
    // Undefined URL falls back to the chain's default public RPC — fine for
    // local dev, but production must set both NEXT_PUBLIC_*_RPC_URL vars.
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL),
  },
  // SSR + explicit storage: wagmi's default storage backend tries to touch
  // indexedDB during Next.js static generation and emits "ReferenceError:
  // indexedDB is not defined" for every prerendered route. We give it
  // noopStorage on the server (no persistence — there's no session to
  // restore there anyway) and localStorage on the client. `ssr: true` is
  // the matching hydration hint for wagmi v2.
  ssr: true,
  storage: createStorage({
    storage: typeof window !== "undefined" ? window.localStorage : noopStorage,
  }),
});

export function ChainProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ThirdwebProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </WagmiProvider>
    </ThirdwebProvider>
  );
}
