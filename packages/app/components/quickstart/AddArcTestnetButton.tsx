"use client";

import { useState } from "react";
import { toast } from "sonner";

const ARC_TESTNET = {
  // 5042002 in hex — wallet_addEthereumChain expects 0x-prefixed.
  chainId: "0x4CEF52",
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
} as const;

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function AddArcTestnetButton() {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (typeof window === "undefined" || !window.ethereum?.request) {
      toast.error("No wallet detected. Install MetaMask or another EIP-1193 wallet first.");
      return;
    }
    setBusy(true);
    try {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [ARC_TESTNET],
      });
      toast.success("Arc Testnet added — switch to it in your wallet to continue.");
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e.code === 4001) {
        toast.error("Request rejected — re-click when you're ready.");
      } else if (e.code === -32602) {
        toast.error("Wallet rejected the network params. Check your wallet's network settings.");
      } else {
        toast.error(e.message ?? "Failed to add Arc Testnet.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="pill pill--acc"
    >
      {busy ? "Adding…" : "Add Arc Testnet to my wallet →"}
    </button>
  );
}
