"use client";

import { useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Address } from "viem";
import { toast } from "sonner";
import { gatewayAbi } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";

// Active custody-escrow gateway. Source-of-truth env:
// NEXT_PUBLIC_GATEWAY_ADDRESS. Direct env read — importing from
// `@/lib/chain/client` would transitively pull `pg` (server-only) into the
// client bundle and break the build with "Module not found: 'fs' / 'net'".
const GATEWAY_ADDRESS = (process.env.NEXT_PUBLIC_GATEWAY_ADDRESS ?? "") as Address;

interface ClaimAllButtonProps {
  globalIds: `0x${string}`[];
}

type Step = "idle" | "submitting" | "confirming" | "done" | "error";

/**
 * Permissionless claim button for matured custody-escrow invoices.
 * Calls claim(bytes32[]) on the gateway — anyone can call this, not just
 * the merchant. Funds route to merchants[merchant].payoutAddress.
 */
export function ClaimAllButton({ globalIds }: ClaimAllButtonProps) {
  const [step, setStep] = useState<Step>("idle");
  const { writeContractAsync } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const { isSuccess } = useWaitForTransactionReceipt({ hash });

  if (globalIds.length === 0) {
    return <p className="mono text-[11px] text-[var(--fg-3)]">No matured escrows to claim.</p>;
  }

  if (isSuccess && step !== "done") setStep("done");

  async function onClick() {
    setStep("submitting");
    try {
      const tx = await writeContractAsync({
        address:      GATEWAY_ADDRESS,
        abi:          gatewayAbi,
        functionName: "claim",
        args:         [globalIds],
      });
      setHash(tx);
      setStep("confirming");
    } catch (e) {
      console.error("[claim] failed:", e);
      // mapChainError handles known revert selectors (InvoiceExpired,
      // User rejected, insufficient funds, …) and falls back to a generic
      // "Transaction failed — try again" so wallet error details don't bleed
      // into the toast verbatim.
      toast.error(mapChainError(e));
      setStep("error");
    }
  }

  const label =
    step === "idle"       ? `Claim ${globalIds.length} matured invoice${globalIds.length === 1 ? "" : "s"}` :
    step === "submitting" ? "Submitting…" :
    step === "confirming" ? "Waiting for confirmation…" :
    step === "done"       ? "Claimed ✓" :
    /* error */             "Failed — retry";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={step === "submitting" || step === "confirming" || step === "done"}
        className="pill pill--acc pill--sm"
      >
        {label}
      </button>
      {hash && (
        <p className="mono text-xs text-[var(--fg-3)]">
          tx:{" "}
          <a
            href={`https://testnet.arcscan.app/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--action)] hover:underline"
          >
            {hash.slice(0, 10)}…
          </a>
        </p>
      )}
    </div>
  );
}
