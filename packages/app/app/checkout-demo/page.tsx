"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArcoraLogo } from "@/components/brand/Logo";
import { Coin } from "@/components/ui/Coin";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SiteFooter } from "@/components/landing/SiteFooter";

/**
 * Stand-alone, fully simulated checkout walkthrough — no wallet, no chain
 * call. The math behind every step uses real Arcora constants (1.0863
 * illustrative oracle rate, 2 bps App Kit provider fee, 30 bps Arcora
 * protocol fee) so the numbers a viewer sees match what the deployed
 * gateway charges on Arc testnet. The interactive stepper lets a
 * marketing visitor walk Invoice → Wallet → Quote → Pay → Settled at
 * their own pace.
 */

const ORACLE = 1.0863;
const POOL_FEE_BPS = 2;       // App Kit provider fee
const PROTOCOL_FEE_BPS = 30;  // Arcora gateway fee (deducted from merchant payout)

type Source = "USDC" | "EURC";

const STEPS = ["Invoice", "Wallet", "Quote", "Pay", "Settled"] as const;
type Step = (typeof STEPS)[number];

export default function CheckoutDemoPage() {
  const [stepIdx, setStepIdx] = useState(0);
  const [source, setSource]   = useState<Source>("USDC");
  const [quoteSecs, setQuoteSecs] = useState(90);
  // Pay → Settled transition timer. Held in a ref so Reset (and unmount) can
  // cancel it — otherwise a stale timer yanks a freshly reset demo to Settled.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const merchant = { name: "Demo Store", desc: "Order #ord_8124 · 2 items" };
  const invoice  = { amount: 49.0, currency: "USD", settle: "USDC" };

  // 1 EUR = ORACLE USD. So to deliver $X USDC the EURC payer needs $X / ORACLE
  // EUR before pool fees; same-token USDC payers pay the gross 1:1. Pool fee is
  // baked in by lifting the EURC input slightly so the post-swap output still
  // hits invoice.amount.
  const sourceAmountBeforePoolFee =
    source === "USDC" ? invoice.amount : invoice.amount / ORACLE;
  const sourceAmount =
    source === "USDC"
      ? invoice.amount
      : sourceAmountBeforePoolFee / (1 - POOL_FEE_BPS / 10_000);
  const fee = (invoice.amount * PROTOCOL_FEE_BPS) / 10_000;
  const merchantPayout = invoice.amount - fee;

  // Quote countdown
  useEffect(() => {
    const step = STEPS[stepIdx]!;
    if (step !== "Quote" && step !== "Pay") return;
    const id = setInterval(() => setQuoteSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [stepIdx]);

  useEffect(() => {
    if (STEPS[stepIdx] === "Quote") setQuoteSecs(90);
  }, [stepIdx]);

  function clearSettleTimer() {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }

  // Don't leak the pending transition past unmount.
  useEffect(() => clearSettleTimer, []);

  function reset() {
    clearSettleTimer();
    setStepIdx(0);
    setQuoteSecs(90);
  }

  function step(): Step {
    return STEPS[stepIdx]!;
  }

  return (
    <main className="relative min-h-screen flex flex-col bg-[var(--bg)]">
      <div className="page-bg" aria-hidden />

      <header className="relative z-[1] px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-b border-[var(--border)]">
        <Link href="/" className="flex items-center shrink-0"><ArcoraLogo size={26} /></Link>
        <span className="eyebrow hidden md:inline-flex truncate">
          Checkout demo · simulated · no wallet required
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={reset} className="pill pill--ghost pill--sm">
            Reset
          </button>
          <ThemeToggle />
        </div>
      </header>

      <section className="relative z-[1] flex-1 px-4 sm:px-6 py-8 sm:py-10">
        <div className="max-w-4xl mx-auto">
          <Stepper current={stepIdx} />

          <div className="mt-8 grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6 items-start">
            {/* Active step panel */}
            <div className="card p-5 sm:p-8 min-h-[520px] flex flex-col">
              {step() === "Invoice"  && <StepInvoice merchant={merchant} invoice={invoice} onNext={() => setStepIdx(1)} />}
              {step() === "Wallet"   && <StepWallet  source={source} setSource={setSource} onNext={() => setStepIdx(2)} />}
              {step() === "Quote"    && <StepQuote   source={source} sourceAmount={sourceAmount} fee={fee} merchantPayout={merchantPayout} quoteSecs={quoteSecs} onRefresh={() => setQuoteSecs(90)} onPay={() => { setStepIdx(3); settleTimer.current = setTimeout(() => setStepIdx(4), 3200); }} />}
              {step() === "Pay"      && <StepPaying  source={source} />}
              {step() === "Settled"  && <StepSettled merchant={merchant} invoice={invoice} source={source} sourceAmount={sourceAmount} merchantPayout={merchantPayout} fee={fee} onReset={reset} />}
            </div>

            {/* Order summary rail */}
            <OrderSummary merchant={merchant} invoice={invoice} source={source} sourceAmount={sourceAmount} fee={fee} step={step()} quoteSecs={quoteSecs} />
          </div>
        </div>
      </section>

      <div className="relative z-[1] mono border-t border-[var(--border)] px-4 sm:px-6 py-5 text-[10px] sm:text-[11px] text-[var(--fg-3)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span>Illustrative quote at {ORACLE} EUR/USD; production rates come live from Arc&apos;s App Kit Swap. Fee numbers match the deployed gateway config.</span>
        <Link href="/" className="text-[var(--action)] hover:underline whitespace-nowrap">← Back to landing</Link>
      </div>
      <SiteFooter />
    </main>
  );
}

/* ── Stepper ─────────────────────────────────────────────────────────── */
function Stepper({ current }: { current: number }) {
  return (
    <div>
      <div className="steps-rail" aria-hidden="true">
        {STEPS.map((s, i) => (
          <i key={s} className={i < current ? "done" : i === current ? "cur" : ""} />
        ))}
      </div>
      <div className="mono flex justify-between text-[10px] uppercase tracking-[0.06em] text-[var(--fg-3)] mt-2">
        {STEPS.map((s, i) => (
          <span
            key={s}
            aria-current={i === current ? "step" : undefined}
            className={
              i === current
                ? "text-[var(--fg-1)] font-semibold"
                : i < current
                ? "text-[var(--action)]"
                : ""
            }
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Step 1: Invoice ─────────────────────────────────────────────────── */
function StepInvoice({ merchant, invoice, onNext }: {
  merchant: { name: string; desc: string }; invoice: { amount: number; currency: string; settle: string }; onNext: () => void;
}) {
  return (
    <div className="flex flex-col flex-1">
      <p className="eyebrow">Step 1 · Invoice</p>
      <h2 className="disp mt-3 text-[28px] font-medium">
        Pay {merchant.name}
      </h2>
      <p className="lead mt-1">{merchant.desc}</p>

      <div className="field mt-6 p-6 flex items-baseline justify-between gap-4">
        <span className="eyebrow">Total due</span>
        <span className="mono text-[30px] font-light leading-none tracking-[-0.02em] text-[var(--fg-1)]">
          ${invoice.amount.toFixed(2)} <span className="text-[15px] text-[var(--fg-3)]">{invoice.currency}</span>
        </span>
      </div>

      <p className="lead mt-6 text-sm">
        Merchant receives in <span className="text-[var(--fg-1)] font-semibold">{invoice.settle}</span> on Arc, regardless
        of which stablecoin you choose to pay with.
      </p>

      <button onClick={onNext} className="pill pill--acc mt-auto self-start">
        Continue → connect wallet
      </button>
    </div>
  );
}

/* ── Step 2: Wallet ──────────────────────────────────────────────────── */
function StepWallet({ source, setSource, onNext }: {
  source: Source; setSource: (s: Source) => void; onNext: () => void;
}) {
  return (
    <div className="flex flex-col flex-1">
      <p className="eyebrow">Step 2 · Wallet</p>
      <h2 className="disp mt-3 text-[28px] font-medium">
        Choose how you want to pay
      </h2>

      <div role="radiogroup" aria-label="Pay-in token" className="mt-6 grid grid-cols-2 gap-3">
        {(["USDC", "EURC"] as const).map(s => {
          const selected = source === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setSource(s)}
              className="field p-5 text-left transition-colors"
              style={{
                borderColor: selected ? "var(--acc)" : "var(--border)",
                background: selected ? "var(--acc-soft)" : "var(--surface-2)",
              }}
            >
              <div className="flex items-center gap-2.5">
                <Coin sym={s} />
                <span className="text-[18px] font-semibold text-[var(--fg-1)]">{s}</span>
              </div>
              <div className="mt-1 text-xs text-[var(--fg-3)]">on Arc testnet</div>
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--fg-3)]">
                <span className="size-1.5 rounded-full bg-[var(--success)]" /> Available
              </div>
            </button>
          );
        })}
      </div>

      <p className="lead mt-5 text-sm max-w-md">
        Real Arcora connects via SIWE / wagmi — this demo skips the signature so you can step
        through the flow.
      </p>

      <div aria-hidden className="flex-1 min-h-12" />
      <button onClick={onNext} className="pill pill--acc self-start">
        Connect &amp; continue →
      </button>
    </div>
  );
}

/* ── Step 3: Quote ───────────────────────────────────────────────────── */
function StepQuote({ source, sourceAmount, fee, merchantPayout, quoteSecs, onRefresh, onPay }: {
  source: Source; sourceAmount: number; fee: number; merchantPayout: number; quoteSecs: number; onRefresh: () => void; onPay: () => void;
}) {
  const expired = quoteSecs <= 0;
  const sameToken = source === "USDC";
  return (
    <div className="flex flex-col flex-1">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Step 3 · Quote</p>
        <span className={`mono text-xs tabular-nums ${expired ? "text-[var(--danger)]" : "text-[var(--fg-3)]"}`}>
          quote ttl · {quoteSecs.toString().padStart(2, "0")}s
        </span>
      </div>
      <h2 className="disp mt-3 text-[26px] font-medium">
        Live FX, quoted by App Kit
      </h2>

      <div className="field mono mt-6 p-6 space-y-3 text-[12.5px]">
        <Row label="You pay"          value={`${sourceAmount.toFixed(4)} ${source}`} />
        <Row label="Merchant gets"    value={`$${merchantPayout.toFixed(2)} USDC`} highlight />
        <div className="divider" />
        <Row label="App Kit rate"     value={sameToken ? "— same-token, no swap" : `1 EUR = ${ORACLE.toFixed(4)} USD`} muted />
        <Row
          label={`Provider fee · ${POOL_FEE_BPS} bps`}
          value={sameToken ? "— same-token, no swap" : "App Kit RFQ"}
          muted
        />
        <Row label={`Protocol fee · ${PROTOCOL_FEE_BPS} bps`} value={`$${fee.toFixed(2)} (from merchant)`} muted />
      </div>

      <button onClick={expired ? onRefresh : onPay} className="pill pill--acc mt-auto self-start">
        {expired ? "Quote expired — refresh" : `Sign and pay ${sourceAmount.toFixed(4)} ${source}`}
      </button>
    </div>
  );
}

/* ── Step 4: Paying ──────────────────────────────────────────────────── */
function StepPaying({ source }: { source: Source }) {
  return (
    <div className="flex flex-col flex-1 justify-center items-center gap-6">
      <div className="size-14 rounded-full border-4 border-[var(--border)] border-t-[var(--action)] animate-spin" />
      <div className="text-center">
        <p className="eyebrow">Step 4 · Pay</p>
        <h2 className="disp mt-3 text-[26px] font-medium">
          Settling on Arc
        </h2>
        <p className="lead mt-2 text-sm max-w-md">
          {source === "USDC"
            ? "Same-token branch: relayer pulls your USDC via Permit2 and forwards it straight to the merchant — no swap, no slippage."
            : "Cross-stable: relayer pulls your EURC via Permit2, runs App Kit Swap on Arc, and pays the merchant in USDC. Sub-30s end-to-end."}
        </p>
      </div>
    </div>
  );
}

/* ── Step 5: Settled ─────────────────────────────────────────────────── */
function StepSettled({ merchant, invoice, source, sourceAmount, merchantPayout, fee, onReset }: {
  merchant: { name: string }; invoice: { amount: number; settle: string };
  source: Source; sourceAmount: number; merchantPayout: number; fee: number;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col flex-1">
      <p className="eyebrow eyebrow--acc">Step 5 · Settled</p>
      <h2 className="disp mt-3 text-[28px] font-medium">
        Payment confirmed.
      </h2>
      <p className="lead mt-2">
        {merchant.name} received <span className="text-[var(--fg-1)] font-semibold">${merchantPayout.toFixed(2)} {invoice.settle}</span> on Arc —
        the InvoicePaid webhook is on its way.
      </p>

      <div className="field mono mt-6 p-6 space-y-3 text-[12.5px]">
        <Row label="You paid"        value={`${sourceAmount.toFixed(4)} ${source}`} />
        <Row label="Merchant payout" value={`$${merchantPayout.toFixed(2)} ${invoice.settle}`} highlight />
        <div className="divider" />
        <Row label="Invoice gross"   value={`$${invoice.amount.toFixed(2)} ${invoice.settle}`} muted />
        <Row label="Protocol fee"    value={`$${fee.toFixed(2)} ${invoice.settle}`} muted />
        <Row label="Tx hash"         value="0x…simulated" muted />
        <Row label="Webhook"         value="invoice.paid · queued" muted />
      </div>

      <div className="mt-auto flex gap-3 pt-6 flex-wrap">
        <button onClick={onReset} className="pill pill--ghost">Run it again</button>
        <Link href="/m/dashboard" className="pill pill--acc">Open merchant dashboard →</Link>
      </div>
    </div>
  );
}

/* ── Order summary rail ──────────────────────────────────────────────── */
function OrderSummary({ merchant, invoice, source, sourceAmount, fee, step, quoteSecs }: {
  merchant: { name: string }; invoice: { amount: number; settle: string };
  source: Source; sourceAmount: number; fee: number;
  step: Step; quoteSecs: number;
}) {
  return (
    <aside className="card p-5 sm:p-6 md:sticky md:top-6">
      <div className="eyebrow mb-4">
        Order summary
      </div>
      <div className="space-y-3 text-sm">
        <Row label={merchant.name} value={`$${invoice.amount.toFixed(2)}`} />
        <div className="divider" />
        <Row label="Total"  value={`$${invoice.amount.toFixed(2)} ${invoice.settle}`} highlight />
      </div>

      <div className="mono mt-5 pt-5 border-t border-[var(--border)] space-y-2 text-[12px]">
        <Row label="You pay" value={`${sourceAmount.toFixed(4)} ${source}`} muted />
        <Row label="Protocol fee" value={`$${fee.toFixed(2)}`} muted />
        {(step === "Quote" || step === "Pay") && (
          <Row label="Quote ttl" value={`${quoteSecs}s`} muted />
        )}
      </div>
    </aside>
  );
}

function Row({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--fg-3)]">{label}</span>
      <span className={`tabular-nums ${
        highlight ? "text-[var(--fg-1)] font-semibold" :
        muted     ? "text-[var(--fg-3)]" : "text-[var(--fg-1)]"
      }`}>
        {value}
      </span>
    </div>
  );
}
