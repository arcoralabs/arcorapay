"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

/**
 * One-time on-chain merchant activation for the custody-escrow gateway.
 *
 * Why it exists: the custody gateway requires every merchant to call
 * `registerMerchant` once before any invoice can be created. Until they do,
 * `/api/invoices` reverts on-chain with `MerchantInactive`. This card walks
 * them through the registration; afterwards Settings prompts for the server
 * delegate authorization (so the relayer can submit invoices on their behalf
 * via createInvoiceFor with RIGHT_CREATE_INVOICE).
 *
 * The gateway address resolves from `NEXT_PUBLIC_GATEWAY_ADDRESS`, which
 * points at the live custody-escrow deployment recorded in
 * `packages/contracts/deployments/arc-testnet.json`.
 *
 * Hidden once the merchant is registered on the active gateway.
 */

// Active custody-escrow gateway. Source-of-truth env: NEXT_PUBLIC_GATEWAY_ADDRESS.
const GATEWAY_ADDRESS = (
  process.env.NEXT_PUBLIC_GATEWAY_ADDRESS ?? ""
) as Address;
const ARC_CHAIN_ID = 5042002;
// Bit-flag right for createInvoiceFor (RIGHT_CREATE_INVOICE = 1 << 0)
const RIGHT_CREATE_INVOICE = 1;

interface Props {
  payoutAddress: string;
  payoutToken: string;
}

export function MerchantActivationCard({ payoutAddress, payoutToken }: Props) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Probe registration on the active gateway on mount (and after a tx).
  useEffect(() => {
    if (!address || !publicClient || !GATEWAY_ADDRESS.startsWith("0x")) {
      setRegistered(null);
      return;
    }
    let cancelled = false;
    publicClient.readContract({
      address: GATEWAY_ADDRESS,
      abi: GATEWAY_ABI,
      functionName: "merchants",
      args: [address],
    }).then((res) => {
      if (cancelled) return;
      // merchants() returns (payoutAddress, payoutToken, active). Index 2 is active.
      const active = (res as [string, string, boolean])[2];
      setRegistered(active);
    }).catch(() => {
      if (cancelled) return;
      setRegistered(null);
    });
    return () => { cancelled = true; };
  }, [address, publicClient]);

  async function handleActivate() {
    if (!address) return;
    if (chainId !== ARC_CHAIN_ID) {
      toast.error("Switch to Arc Testnet to continue");
      return;
    }
    if (!GATEWAY_ADDRESS.startsWith("0x")) {
      toast.error("Gateway not configured. Contact support.");
      return;
    }
    setBusy(true);
    try {
      const txHash = await writeContractAsync({
        address: GATEWAY_ADDRESS,
        abi: GATEWAY_ABI,
        functionName: "registerMerchant",
        args: [payoutAddress as Address, payoutToken as Address],
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("registration reverted");
      toast.success("Activation successful — registered on the custody gateway.");
      setRegistered(true);
    } catch (e) {
      toast.error(mapChainError(e));
    } finally {
      setBusy(false);
    }
  }

  // Hide until we know status. Hide if already registered or env missing.
  if (!GATEWAY_ADDRESS.startsWith("0x")) return null;
  if (registered !== false) return null;

  return (
    <div
      className="card border-[var(--acc-line)] p-5 sm:px-[18px] sm:py-4"
      style={{ background: "color-mix(in oklch, var(--acc) 5%, var(--surface))" }}
    >
      <div className="flex items-start gap-[14px]">
        <div className="w-9 h-9 rounded-full bg-[var(--acc-soft)] border border-[var(--acc-line)] flex items-center justify-center flex-none text-[color-mix(in_oklch,var(--acc)_75%,var(--fg-1))]">
          <ShieldCheck className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm text-[var(--fg-1)]">Activate the gateway</h3>
          <p className="mt-1 text-sm text-[var(--fg-2)] leading-relaxed">
            Arcora&apos;s custody-escrow gateway settles funds into per-invoice
            escrow for 7 days (the refundable window) before they&apos;re
            claimable. Register once on-chain to start accepting payments.
            After this you&apos;ll be prompted to authorize the server delegate
            from <span className="font-medium text-[var(--fg-1)]">Settings</span>.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleActivate}
              disabled={!address || busy}
              aria-busy={busy || undefined}
              className="pill pill--acc pill--sm"
            >
              {busy ? "Registering…" : "Activate gateway →"}
            </button>
            <span className="mono text-[11px] text-[var(--fg-3)]">
              One-time signature, ~10s.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
