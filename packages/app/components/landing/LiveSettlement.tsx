"use client";

import { useEffect, useState } from "react";

/**
 * Loops a simulated, label-honest replay of the Permit2 → settle flow on
 * Arc Testnet. Quote rate is illustrative (real testnet RFQ rates from App
 * Kit Swap drift 0.80–0.92 USD/EUR; the live demo /checkout-demo uses the
 * actual quote endpoint). Three scenarios cycle: same-token USDC→USDC,
 * swap EURC→USDC, swap USDC→EURC. Each walks Quote → Sign → Settled.
 */

type Phase = "quote" | "pay" | "settled";

interface Scenario {
  id: string;          // visible "merchantInvoiceId" — short
  payIn: "USDC" | "EURC";
  payout: "USDC" | "EURC";
  amountOutMicro: number; // 6-dec base units
}

const SCENARIOS: Scenario[] = [
  { id: "INV-1024", payIn: "USDC", payout: "USDC", amountOutMicro: 1_000_000 },
  { id: "INV-1025", payIn: "EURC", payout: "USDC", amountOutMicro: 1_000_000 },
  { id: "INV-1026", payIn: "USDC", payout: "EURC", amountOutMicro: 1_000_000 },
];

const ORACLE = 1.0863;        // illustrative EUR/USD rate; real swap quotes come from App Kit RFQ
const POOL_FEE_BPS = 2;       // App Kit provider fee on every swap (0.02%)
const PROTOCOL_FEE_BPS = 30;  // Arcora gateway fee (deducted from merchant payout)
const GATEWAY_ADDR = "0x07BAC1…aE3a3"; // Live ArcFXGateway (custody-escrow) on Arc Testnet

function calcAmountIn(s: Scenario): number {
  // Same-token: customer pays exactly amountOut (no swap).
  if (s.payIn === s.payout) return s.amountOutMicro;
  // EURC→USDC: customer needs (amountOut / rate) EURC, plus pool fee.
  if (s.payIn === "EURC" && s.payout === "USDC") {
    return Math.ceil((s.amountOutMicro / ORACLE) / (1 - POOL_FEE_BPS / 10_000));
  }
  // USDC→EURC: customer needs (amountOut * rate) USDC, plus pool fee.
  return Math.ceil((s.amountOutMicro * ORACLE) / (1 - POOL_FEE_BPS / 10_000));
}

function calcMerchantPayout(s: Scenario): number {
  return s.amountOutMicro - Math.floor((s.amountOutMicro * PROTOCOL_FEE_BPS) / 10_000);
}

function fmt(microUnits: number): string {
  return (microUnits / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
}

const PHASE_IDX: Record<Phase, number> = { quote: 0, pay: 1, settled: 2 };

export function LiveSettlement() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("quote");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Phase progression: quote(1.4s) → pay(1.4s) → settled(2.2s) → next scenario
    const sched: Array<[Phase, number]> = [
      ["quote",   1400],
      ["pay",     1400],
      ["settled", 2200],
    ];
    let cancelled = false;
    let i = 0;
    function step() {
      if (cancelled) return;
      const [p, ms] = sched[i]!;
      setPhase(p);
      setTick(t => t + 1);
      setTimeout(() => {
        i = (i + 1) % sched.length;
        if (i === 0) setScenarioIdx(s => (s + 1) % SCENARIOS.length);
        step();
      }, ms);
    }
    step();
    return () => { cancelled = true; };
  }, []);

  const s          = SCENARIOS[scenarioIdx]!;
  const sameToken  = s.payIn === s.payout;
  const amountIn   = calcAmountIn(s);
  const payout     = calcMerchantPayout(s);
  const fee        = s.amountOutMicro - payout;
  const phaseIdx   = PHASE_IDX[phase];

  return (
    <div className="card overflow-hidden" style={{ boxShadow: "var(--elev-3)" }}>
      {/* Header — live strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5" style={{ background: "var(--bg-sunken)" }}>
        <span className="mono inline-flex items-center gap-2.5 text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--fg-3)" }}>
          <span className="dot dot--live shrink-0" />
          <span className="sm:hidden">Live · Arc testnet</span>
          <span className="hidden sm:inline">Live · Arc testnet · gateway {GATEWAY_ADDR}</span>
        </span>
        <span className="mono text-[11px] tabular-nums whitespace-nowrap" style={{ color: "var(--fg-3)" }}>
          oracle 1 EUR = {ORACLE.toFixed(4)} USD
        </span>
      </div>

      {/* Body — customer / gateway / merchant panes */}
      <div className="settle-grid grid items-stretch" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
        <Side
          side="Customer"
          token={s.payIn}
          amountMicro={amountIn}
          highlight={phase === "quote" || phase === "pay"}
          dim={phase === "settled"}
          subline={phase === "quote" ? "Quote ready" : phase === "pay" ? "Approving + paying…" : "Tx confirmed"}
        />

        {/* Middle pane — gateway + flow */}
        <div
          className="settle-mid flex flex-col justify-between gap-3.5 px-5 py-6"
          style={{
            borderLeft: "1px solid var(--border)",
            borderRight: "1px solid var(--border)",
            background: "var(--bg-sunken)",
            minWidth: 280,
          }}
        >
          <div className="text-center">
            <div className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--fg-3)" }}>
              {sameToken ? "Same-token · no swap" : "Swap via App Kit · Permit2"}
            </div>
            <div className="mt-1 text-[18px] font-semibold">ArcFXGateway</div>
          </div>

          {/* Flow line with moving dot */}
          <div className="relative my-1.5 h-[2px] w-full" style={{ background: "var(--border)" }}>
            <span
              key={`${scenarioIdx}-${phase}-${tick}`}
              className={`absolute top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-full${phase === "settled" ? "" : " anim-flow-dot"}`}
              style={{
                background: "var(--acc)",
                boxShadow: "0 0 12px var(--acc-glow)",
                left: phase === "settled" ? "98%" : undefined,
              }}
            />
          </div>

          {/* Cost breakdown */}
          <div className="mono flex w-full flex-col gap-1.5 text-[10.5px] tabular-nums" style={{ color: "var(--fg-3)" }}>
            <Row k="amount in" v={`${fmt(amountIn)} ${s.payIn}`} />
            {!sameToken && <Row k={`swap fee · ${POOL_FEE_BPS} bps`} v="pool" />}
            <Row k={`protocol · ${PROTOCOL_FEE_BPS} bps`} v={`${fmt(fee)} ${s.payout}`} />
          </div>
        </div>

        <Side
          side="Merchant"
          token={s.payout}
          amountMicro={payout}
          highlight={phase === "settled"}
          dim={phase !== "settled"}
          subline={phase === "settled" ? "✓ Settled · webhook fired" : phase === "pay" ? "Awaiting confirmation…" : "Pending"}
          align="right"
        />
      </div>

      {/* Footer — invoice + phase progress */}
      <div className="flex items-center justify-between gap-3 border-t px-5 py-3" style={{ background: "var(--bg-sunken)" }}>
        <span className="mono min-w-0 truncate text-[11px] tracking-[0.06em]" style={{ color: "var(--fg-3)" }}>
          invoice <span style={{ color: "var(--fg-1)" }}>{s.id}</span> · {s.payIn} → {s.payout}
        </span>
        <div className="steps-rail w-[90px] shrink-0">
          {[0, 1, 2].map(i => (
            <i key={`${scenarioIdx}-${tick}-${i}`} className={phaseIdx > i ? "done" : phaseIdx === i ? "cur" : ""} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 whitespace-nowrap">
      <span>{k}</span>
      <span style={{ color: "var(--fg-1)" }}>{v}</span>
    </div>
  );
}

function Side({
  side, token, amountMicro, highlight, dim, subline, align,
}: {
  side: "Customer" | "Merchant";
  token: "USDC" | "EURC";
  amountMicro: number;
  highlight: boolean;
  dim: boolean;
  subline: string;
  align?: "right";
}) {
  return (
    <div
      className={`flex flex-col gap-2 px-6 py-7 transition-opacity duration-500 ${
        dim ? "opacity-50" : "opacity-100"
      } ${align === "right" ? "md:items-end md:text-right" : ""}`}
    >
      <div className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--fg-3)" }}>
        {side}
      </div>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="mono text-[30px] font-light tabular-nums tracking-[-0.02em]">
          {fmt(amountMicro)}
        </span>
        <span
          className="mono rounded-lg border px-2 py-[3px] text-[10px] uppercase tracking-[0.06em] transition-all"
          style={
            highlight
              ? { borderColor: "var(--acc)", background: "var(--acc)", color: "var(--acc-ink)" }
              : { borderColor: "var(--border)", background: "transparent", color: "var(--fg-3)" }
          }
        >
          {token}
        </span>
      </div>
      <div className="mono text-[12px]" style={{ color: "var(--fg-3)" }}>{subline}</div>
    </div>
  );
}
