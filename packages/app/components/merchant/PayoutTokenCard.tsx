"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { toast } from "sonner";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { mapChainError } from "@/lib/chain/error-mapper";
import { symbolForAddress } from "@/lib/ui/format";
import { Coin } from "@/components/ui/Coin";

// Active custody-escrow gateway. Source-of-truth env: NEXT_PUBLIC_GATEWAY_ADDRESS.
const GATEWAY = (process.env.NEXT_PUBLIC_GATEWAY_ADDRESS ?? "") as Address;
const USDC = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "") as Address;
const EURC = (process.env.NEXT_PUBLIC_EURC_ADDRESS ?? "") as Address;

interface TokenChoice {
  address: Address;
  symbol: string;
  fiat: string;
}

const CHOICES: TokenChoice[] = [
  { address: USDC, symbol: "USDC", fiat: "US Dollar" },
  { address: EURC, symbol: "EURC", fiat: "Euro" },
].filter((c) => c.address.startsWith("0x") && c.address.length === 42);

interface Props {
  currentPayoutToken: string;
  onUpdated?: () => void;
}

export function PayoutTokenCard({ currentPayoutToken, onUpdated }: Props) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [selected, setSelected] = useState<Address>(currentPayoutToken as Address);
  const [busy, setBusy] = useState(false);

  // Keep selected in sync if the parent refreshes with a new value.
  useEffect(() => {
    setSelected(currentPayoutToken as Address);
  }, [currentPayoutToken]);

  const currentSymbol = symbolForAddress(currentPayoutToken);
  const dirty = selected.toLowerCase() !== currentPayoutToken.toLowerCase();

  async function handleSave() {
    if (!address || !publicClient) return;
    if (!GATEWAY.startsWith("0x")) {
      toast.error("Gateway not configured.");
      return;
    }
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: GATEWAY,
        abi: GATEWAY_ABI,
        functionName: "updatePayoutToken",
        args: [selected],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("update reverted");

      const res = await fetch("/api/merchant/payout-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payoutToken: selected }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `sync_failed_${res.status}`);
      }

      toast.success(`Settle currency updated to ${symbolForAddress(selected)}`);
      onUpdated?.();
    } catch (e) {
      toast.error(mapChainError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold m-0">Payout token</h3>
        <span className="tagchip">{currentSymbol}</span>
      </div>
      <p className="lead text-[13px] mt-1 mb-4">
        Settlement currency for every invoice. Existing invoices keep
        their original settle token; only new invoices use this one.
      </p>

      <div role="radiogroup" aria-label="Settle currency" className="flex flex-wrap gap-2 mb-4">
        {CHOICES.map((c) => {
          const isSelected = selected.toLowerCase() === c.address.toLowerCase();
          return (
            <button
              key={c.address}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(c.address)}
              disabled={busy}
              className="field inline-flex items-center gap-2 rounded-full px-3.5 py-2 transition-colors"
              style={{
                borderColor: isSelected ? "var(--acc)" : "var(--border)",
                background: isSelected ? "var(--acc-soft)" : "var(--surface-2)",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Coin sym={c.symbol} />
              <span className="text-[13px] font-semibold">{c.symbol}</span>
              <span className="text-[11px] text-[var(--fg-3)]">{c.fiat}</span>
              {isSelected && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="mono text-[11px] text-[var(--fg-3)]">
          One on-chain transaction, ~10s.
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || busy || !address}
          className="pill pill--acc pill--sm"
        >
          {busy ? "Updating…" : dirty ? "Update on-chain" : "No change"}
        </button>
      </div>
    </section>
  );
}
