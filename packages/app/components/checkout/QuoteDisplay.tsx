"use client";

import { useEffect, useRef, useState } from "react";
import { formatTokenAmount, symbolForAddress } from "@/lib/ui/format";
import { RefreshCw } from "lucide-react";

interface QuoteResponse {
  /** Recommended payIn (decimal string) — what the customer commits. */
  amountIn?:        string;
  /** Estimated payout (decimal string) — what the merchant receives. */
  estimatedOutput?: string;
  fees?:            { token: string; amount: string; type: string }[];
  ttlSeconds:       number;
  error?:           string;
}

interface QuoteDisplayProps {
  payInTokenAddress:  string;
  payoutTokenAddress: string;
  /** Invoice's amountOut, base units of payoutToken — the floor we settle to. */
  amountOut:          string;
  /** Both bigints in base units; PayButton needs payInAmount to sign. */
  onQuote:            (estimatedOut: bigint, payInAmount: bigint) => void;
  onStale:            () => void;
}

export function QuoteDisplay(props: QuoteDisplayProps) {
  const sameToken = props.payInTokenAddress.toLowerCase() === props.payoutTokenAddress.toLowerCase();
  const exactOut  = BigInt(props.amountOut);

  const [estimateOut, setEstimateOut] = useState<bigint | null>(sameToken ? exactOut : null);
  const [payInAmount, setPayInAmount] = useState<bigint | null>(sameToken ? exactOut : null);
  const [stale,   setStale]           = useState(false);
  const [loading, setLoading]         = useState(!sameToken);
  const [error,   setError]           = useState<string | null>(null);
  const fetchedAt = useRef<number>(0);
  const ttlRef    = useRef<number>(30);
  // Mirror `stale` into a ref so the mount-only interval can read the current
  // value without requiring it in the dependency array.
  const staleRef  = useRef(false);
  useEffect(() => { staleRef.current = stale; }, [stale]);

  async function fetchQuote() {
    setLoading(true);
    setError(null);
    try {
      // Audit #31: previously fell back to "EURC" for any unknown token,
      // which silently quoted the wrong asset. Reject explicitly so a
      // misconfigured env or a future third stable surfaces as an error
      // rather than a corrupted quote.
      const usdcAddr = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "").toLowerCase();
      const eurcAddr = (process.env.NEXT_PUBLIC_EURC_ADDRESS ?? "").toLowerCase();
      const symbolFor = (a: string): "USDC" | "EURC" => {
        const low = a.toLowerCase();
        if (low === usdcAddr) return "USDC";
        if (low === eurcAddr) return "EURC";
        throw new Error(`unsupported token ${a}`);
      };
      // targetOutput mode — backend probes the rate, divides, adds slippage
      // buffer. Returns a recommended `amountIn` we lock in for signing.
      const body = {
        payInToken:   symbolFor(props.payInTokenAddress),
        payoutToken:  symbolFor(props.payoutTokenAddress),
        targetOutput: humanizeAmount(BigInt(props.amountOut), 6),
      };
      const res = await fetch("/api/checkout/quote", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data: QuoteResponse = await res.json();
      if (!res.ok || !data.estimatedOutput || !data.amountIn) {
        throw new Error(data.error ?? `quote failed: ${res.status}`);
      }
      const out = parseHumanAmount(data.estimatedOutput, 6);
      const inn = parseHumanAmount(data.amountIn, 6);
      setEstimateOut(out);
      setPayInAmount(inn);
      props.onQuote(out, inn);
      fetchedAt.current = Date.now();
      ttlRef.current = data.ttlSeconds;
      setStale(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "quote unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sameToken) {
      // Direct payment path — payInToken == payoutToken means no swap, no
      // App Kit RFQ. Customer commits exactly amountOut; the relayer's
      // settle path skips kit.swap on the same-token branch. Without this
      // bypass the quote endpoint returns same_token 400 and the UI gets
      // stuck with an estimated output of "same_token".
      props.onQuote(exactOut, exactOut);
      return;
    }
    void fetchQuote();
    const t = setInterval(() => {
      const ageS = (Date.now() - fetchedAt.current) / 1000;
      // Read staleRef.current (not the closure-captured `stale`) so the guard
      // reflects the actual current value. Fire onStale exactly once on the
      // false→true edge; staleRef.current is set synchronously here to prevent
      // a tight loop double-fire before the React re-render propagates.
      if (ageS > ttlRef.current && !staleRef.current) {
        staleRef.current = true;
        setStale(true);
        props.onStale();
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payInSym  = symbolForAddress(props.payInTokenAddress);
  const payoutSym = symbolForAddress(props.payoutTokenAddress);

  return (
    <div className={`field overflow-hidden ${stale ? "border-[var(--warning)]" : ""}`}>
      {/* Quote card header */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span
            className={stale ? "dot" : "dot dot--live"}
            style={stale ? { background: "var(--warning)" } : undefined}
            aria-hidden
          />
          <span className="text-[12px] font-medium text-[var(--fg-1)]">
            {sameToken ? "Direct payment" : "Live quote · App Kit Swap RFQ"}
          </span>
        </div>
        {sameToken && <span className="tagchip tagchip--ok">No swap</span>}
        {stale && (
          <button
            type="button"
            onClick={() => void fetchQuote()}
            disabled={loading}
            className="mono flex items-center gap-1.5 text-[11px] font-medium text-[var(--action)] hover:underline disabled:opacity-50"
          >
            <RefreshCw className="size-3" /> Refresh
          </button>
        )}
      </div>

      {/* Quote body — two-column with arrow */}
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-[1fr_32px_1fr] items-center gap-3">
          {/* You pay */}
          <div>
            <div className="eyebrow mb-2">You pay</div>
            {loading && !payInAmount ? (
              <div className="h-7 w-24 rounded-[6px] bg-[var(--surface-3)] animate-pulse" />
            ) : (
              <div className="mono font-light text-[26px] leading-[1] tracking-[-0.02em] text-[var(--fg-1)]">
                {payInAmount ? formatTokenAmount(payInAmount) : "—"}
                <span className="text-[13px] text-[var(--fg-3)] font-normal ml-1.5 tracking-[0.02em]">
                  {payInSym}
                </span>
              </div>
            )}
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center size-8 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-3)] text-[15px] self-end mb-1">
            →
          </div>

          {/* Merchant receives */}
          <div className="text-right">
            <div className="eyebrow mb-2">Merchant receives</div>
            {loading && !estimateOut ? (
              <div className="h-7 w-24 rounded-[6px] bg-[var(--surface-3)] animate-pulse ml-auto" />
            ) : error ? (
              <div className="text-[13px] text-[var(--danger)]">{error}</div>
            ) : (
              <div className="mono font-light text-[26px] leading-[1] tracking-[-0.02em] text-[var(--fg-1)]">
                {estimateOut ? formatTokenAmount(estimateOut) : "—"}
                <span className="text-[13px] text-[var(--fg-3)] font-normal ml-1.5 tracking-[0.02em]">
                  {payoutSym}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Rate footer */}
        {!sameToken && !loading && !error && payInAmount && estimateOut && (
          <div className="mono flex items-center justify-between mt-4 pt-4 border-t border-[var(--border)] text-[11px] text-[var(--fg-3)]">
            <span>
              Rate{" "}
              <span className="text-[var(--fg-1)]">
                1 {payInSym} = {(Number(estimateOut) / Number(payInAmount)).toFixed(4)} {payoutSym}
              </span>
            </span>
            {stale ? (
              <span className="text-[var(--warning)] font-semibold tracking-[0.06em] uppercase">Quote stale</span>
            ) : (
              <span className="tagchip">Fixed</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function parseHumanAmount(amount: string, decimals: number): bigint {
  const [wholeStr = "0", fracStr = ""] = amount.split(".");
  const fracPadded = fracStr.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(wholeStr) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

function humanizeAmount(baseUnits: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = baseUnits / scale;
  const frac  = (baseUnits % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}
