"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useChainId } from "wagmi";
import { type Hex, type Address } from "viem";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { gatewayAbi } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";

interface RefundButtonProps {
  invoiceId: string;
  payoutToken: string;
  /** The gateway address this invoice lives on. Custody-escrow model —
   *  no ERC-20 allowance needed. Falls back to NEXT_PUBLIC_GATEWAY_ADDRESS. */
  gatewayAddress?: string | null;
  /** `claimableAt` from the DB row — the end of the 7-day escrow window. This is
   *  a SOFT window (AFG-013): refundInvoice() stays callable on-chain until
   *  someone calls claim() (which flips status off "paid"). After claimableAt,
   *  claim() is permissionless, so a refund then RACES a claim (first tx wins). */
  claimableAt?: string | null;
  /** Current invoice status — only "paid" invoices are refundable. */
  status?: string;
  onRefunded?: () => void;
}

type State = "idle" | "refunding" | "success" | "error";

export function RefundButton({ invoiceId, payoutToken: _payoutToken, gatewayAddress, claimableAt, status, onRefunded }: RefundButtonProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<State>("idle");

  // AFG-013: refunds stay valid until the escrow is CLAIMED (status leaves
  // "paid"), not at claimableAt. Gate on status only; once the window elapses,
  // claim() is permissionless so a refund races it (first tx wins) — surface
  // that instead of hiding the button as if the window were a hard cutoff.
  const refundEndsAt = claimableAt ? new Date(claimableAt) : null;
  const isPaid = status === "paid" || status === undefined;
  const windowElapsed = refundEndsAt !== null && Date.now() >= refundEndsAt.getTime();

  const fallbackGateway = process.env.NEXT_PUBLIC_GATEWAY_ADDRESS as Address;
  const gateway = (gatewayAddress ?? fallbackGateway) as Address;
  const arcId = 5042002;

  if (!isPaid) return null;

  async function handleClick() {
    if (!address) return;
    if (chainId !== arcId) {
      toast.error("Switch to Arc Testnet to continue");
      return;
    }
    // AFG-013: after the window, a claim() can land first and the refund will
    // revert. Make the race explicit before sending.
    if (windowElapsed && !window.confirm(
      "The 7-day refund window has elapsed. Anyone can now claim this escrow — " +
      "if a claim lands before your refund, the refund will revert. Continue?",
    )) return;
    setState("refunding");
    try {
      // Custody-escrow model: no ERC-20 allowance needed — funds held in gateway.
      const refundHash = await writeContractAsync({
        address: gateway,
        abi: gatewayAbi,
        functionName: "refundInvoice",
        args: [invoiceId as Hex],
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: refundHash });
      if (receipt.status !== "success") {
        throw new Error("Refund reverted on-chain.");
      }

      setState("success");
      toast.success("Refund processed.");
      onRefunded?.();
    } catch (e) {
      setState("error");
      toast.error(mapChainError(e));
      setTimeout(() => setState("idle"), 2500);
    }
  }

  const label: Record<State, string> = {
    idle:      "Refund",
    refunding: "Refunding…",
    success:   "Refunded ✓",
    error:     "Retry",
  };
  const inFlight = state === "refunding";

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleClick}
      disabled={!address || inFlight || state === "success"}
      title={windowElapsed
        ? "7-day window elapsed — anyone can now claim this escrow; a refund only succeeds if it lands before a claim."
        : undefined}
      className="text-[var(--action)] text-[12px] hover:bg-[color-mix(in_oklch,var(--fg-1)_6%,transparent)]"
    >
      {label[state]}
    </Button>
  );
}
