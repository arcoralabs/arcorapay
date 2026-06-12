import type { ReactNode } from "react";

/**
 * Vertical pay-flow diagram for /docs index. Pure Tailwind — no SVG so it
 * scales cleanly on mobile (the previous ASCII art clipped at narrow widths).
 *
 * Boxes are arranged in a vertical chain on the left rail; side branches
 * (App Kit Swap, merchant wallet, merchant server) hang off to the right
 * and wrap below their parent on small screens.
 */
export function FlowDiagram() {
  return (
    <div className="my-8 rounded-2xl border bg-[var(--surface-2)] p-5 sm:p-7">
      <Step
        primary={<MainBox title="Customer wallet" />}
      />
      <Connector label="Permit2 signature (gas-less)" />
      <Step
        primary={<MainBox title="Arcora relayer" sub="ops/relayer" />}
        sideLabel="kit.swap"
        side={<SideBox title="App Kit Swap" sub="Circle RFQ FX" />}
      />
      <Connector label="settleInvoice" />
      <Step
        primary={<MainBox title="ArcFXGateway" sub="custody escrow · on Arc" />}
        sideLabel="payout"
        side={<SideBox title="Merchant wallet" />}
      />
      <Connector label="InvoicePaid event" />
      <Step
        primary={<MainBox title="Indexer" sub="ops/indexer" />}
        sideLabel="webhook"
        side={<SideBox title="Merchant server" />}
      />
    </div>
  );
}

function Step({
  primary,
  sideLabel,
  side,
}: {
  primary: ReactNode;
  sideLabel?: string;
  side?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center">{primary}</div>
      {side && (
        <div className="flex items-center gap-2 sm:gap-3 sm:flex-1 sm:min-w-0 ml-5 sm:ml-0">
          <CornerArrow className="sm:hidden" />
          <span className="hidden sm:inline-block flex-1 h-px bg-[var(--border-strong)] max-w-12" />
          {sideLabel && (
            <span className="mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground whitespace-nowrap">
              {sideLabel}
            </span>
          )}
          <ArrowRight />
          <div className="flex items-center min-w-0">{side}</div>
        </div>
      )}
    </div>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 ml-5 sm:ml-7 my-1.5">
      <div className="flex flex-col items-center">
        <span className="block w-px h-6 bg-[var(--border-strong)]" />
        <ArrowDown />
      </div>
      <span className="mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function MainBox({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-[var(--acc-soft)] border border-[var(--acc-line)] px-4 py-3 sm:min-w-[200px]">
      <div className="font-semibold text-foreground text-[15px] leading-tight">{title}</div>
      {sub && (
        <div className="mono text-[10.5px] text-muted-foreground mt-0.5">
          {sub}
        </div>
      )}
    </div>
  );
}

function SideBox({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface)] border px-4 py-3 min-w-0">
      <div className="font-semibold text-foreground text-[15px] leading-tight">{title}</div>
      {sub && (
        <div className="mono text-[10.5px] text-muted-foreground mt-0.5">
          {sub}
        </div>
      )}
    </div>
  );
}

function ArrowRight() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="text-[var(--fg-3)] flex-none">
      <path d="M0 5h12m0 0L8 1m4 4L8 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-[var(--fg-3)] flex-none -mt-0.5">
      <path d="M5 0v8m0 0L1 4m4 4l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CornerArrow({ className }: { className?: string }) {
  // Down-then-right ↳ glyph for mobile side branches.
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none"
      className={`text-[var(--fg-3)] flex-none ${className ?? ""}`}
    >
      <path
        d="M3 1v6a3 3 0 0 0 3 3h7m0 0L9 6m4 4l-4 4"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
