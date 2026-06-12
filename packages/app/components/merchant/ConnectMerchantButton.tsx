"use client";

import { useAccount, useConnect, useSignMessage, useDisconnect } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { SiweMessage } from "siwe";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type Method = "injected" | "walletconnect";

export function ConnectMerchantButton() {
  const { address, isConnected } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [busy, setBusy] = useState<Method | null>(null);

  const hasInjected =
    typeof window !== "undefined" && typeof (window as { ethereum?: unknown }).ethereum !== "undefined";

  async function handleSignIn(method: Method) {
    setBusy(method);
    try {
      let acc = address;
      if (!isConnected) {
        const connector =
          method === "injected"
            ? injected()
            : walletConnect({
                projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
                showQrModal: true,
              });
        const result = await connectAsync({ connector });
        acc = result.accounts[0];
      }
      if (!acc) throw new Error("no account");

      const nonceRes = await fetch("/api/auth/siwe/nonce", { method: "POST" });
      const { nonce } = await nonceRes.json();

      const msg = new SiweMessage({
        domain: window.location.host,
        address: acc,
        statement: "Sign in to Arcora",
        uri: window.location.origin,
        version: "1",
        chainId: 5042002,
        nonce,
      });
      const message = msg.prepareMessage();
      const signature = await signMessageAsync({ message });

      const verify = await fetch("/api/auth/siwe/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!verify.ok) throw new Error("verify failed");

      router.push("/m/dashboard");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sign-in failed";
      toast.error(msg);
      disconnect();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      {hasInjected && (
        <button
          onClick={() => handleSignIn("injected")}
          disabled={busy !== null}
          className="pill pill--acc w-full"
        >
          {busy === "injected" ? "Signing in…" : "Connect browser wallet"}
        </button>
      )}
      <button
        onClick={() => handleSignIn("walletconnect")}
        disabled={busy !== null}
        className={`${hasInjected ? "pill pill--ghost" : "pill pill--acc"} w-full`}
      >
        {busy === "walletconnect"
          ? "Waiting on wallet…"
          : hasInjected
            ? "Or scan with mobile / hardware wallet"
            : "Connect with WalletConnect"}
      </button>
    </div>
  );
}
