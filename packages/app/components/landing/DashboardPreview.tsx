import { useId } from "react";

/**
 * Marketing-side preview of the merchant dashboard, reskinned to the UI v2
 * tokens so it matches the real merchant area (dark surface card, sage chart,
 * chartreuse accents). The chart shape and the activity rows are deliberate
 * placeholders — Arc testnet's real numbers are tiny, and showing $5 of
 * lifetime volume next to "Treasury that reads like a P&L" would undersell
 * the product. The footer disclaimer makes the illustrative status explicit
 * and points the reader at the actual live dashboard at /m/treasury.
 */

const CHART = [10, 18, 14, 22, 30, 26, 38, 34, 44, 52, 48, 60, 56, 68, 74, 70, 82, 88, 84, 96];

const SETTLEMENTS = [
  { id: "0xa9..3f1",  amt: "+$840.00",   ccy: "USDC", t: "14s" },
  { id: "0x47..b22",  amt: "+€1,240.50", ccy: "EURC", t: "1m"  },
  { id: "0xd0..7e8",  amt: "+$92.00",    ccy: "USDC", t: "3m"  },
  { id: "0x12..a90",  amt: "+$2,100.00", ccy: "USDC", t: "8m"  },
  { id: "0x88..c41",  amt: "−$48.00",    ccy: "USDC", t: "12m" },
  { id: "0x6b..029",  amt: "+€312.00",   ccy: "EURC", t: "21m" },
];

export function DashboardPreview() {
  // useId() so multiple instances on the same page (and concurrent SSR
  // streams) don't collide on the static "dash-area" gradient id and
  // accidentally point one SVG's <path fill="url(#…)"> at another's
  // gradient.
  const rawId = useId();
  const gradientId = `dash-area-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const max = Math.max(...CHART);
  const points = CHART.map((p, i) => ({
    x: (i / (CHART.length - 1)) * 400,
    y: 160 - (p / max) * 140,
  }));
  const linePath = "M " + points.map(p => `${p.x},${p.y}`).join(" L ");
  const areaPath = `${linePath} L 400,160 L 0,160 Z`;
  const last = points[points.length - 1]!;

  return (
    <div className="card overflow-hidden" style={{ boxShadow: "var(--elev-3)" }}>
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
        {/* Chart */}
        <div className="border-b p-6 sm:p-7 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="eyebrow mb-2.5">Volume · last 30d</p>
              <div className="mono text-3xl font-light tabular-nums tracking-[-0.02em] sm:text-4xl">
                $1,284,309<span className="text-lg sm:text-xl" style={{ color: "var(--fg-3)" }}>.42</span>
              </div>
              <div className="mono mt-1 text-[11px] tracking-[0.04em]" style={{ color: "var(--sage)" }}>
                ▲ +24.1% vs prev period
              </div>
            </div>
            <div className="seg shrink-0" aria-hidden="true">
              {["1d", "7d", "30d", "All"].map((p, i) => (
                <span key={p} className={i === 2 ? "on" : ""}>
                  {p}
                </span>
              ))}
            </div>
          </div>

          <svg viewBox="0 0 400 160" preserveAspectRatio="none" className="mt-6 h-[160px] w-full">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   style={{ stopColor: "var(--sage)" }} stopOpacity="0.32" />
                <stop offset="100%" style={{ stopColor: "var(--sage)" }} stopOpacity="0" />
              </linearGradient>
            </defs>
            {Array.from({ length: 4 }).map((_, i) => (
              <line key={i} x1="0" y1={40 * (i + 1)} x2="400" y2={40 * (i + 1)}
                style={{ stroke: "var(--border)" }} strokeWidth="0.5" />
            ))}
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path d={linePath} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--sage)" }} />
            <circle cx={last.x} cy={last.y} r="4" style={{ fill: "var(--sage)" }} />
            <circle cx={last.x} cy={last.y} r="8" opacity="0.25" style={{ fill: "var(--sage)" }} />
          </svg>
        </div>

        {/* Mini ledger */}
        <div className="flex flex-col p-6 sm:p-7">
          <div className="mb-3.5 flex items-center justify-between">
            <p className="eyebrow">Recent settlements</p>
            <span className="eyebrow inline-flex items-center gap-1.5">
              <span className="dot dot--live" />
              Live
            </span>
          </div>
          <ul className="flex-1">
            {SETTLEMENTS.map((s, i) => {
              const isNeg = s.amt.startsWith("−");
              return (
                <li
                  key={s.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-[10px] border-b px-2.5 py-2.5 text-[12px] last:border-b-0"
                  style={{
                    borderColor: "var(--border-faint)",
                    background: i === 0 ? "var(--acc-soft)" : "transparent",
                  }}
                >
                  <span className="mono" style={{ color: "var(--fg-3)" }}>{s.id}</span>
                  <span
                    className="mono text-right font-medium tabular-nums"
                    style={{ color: isNeg ? "var(--fg-3)" : "var(--fg-1)" }}
                  >
                    {s.amt}
                  </span>
                  <span className="tagchip tagchip--mut" style={{ height: 20 }}>{s.ccy}</span>
                  <span className="mono text-[11px] tabular-nums" style={{ color: "var(--fg-3)" }}>
                    {s.t} ago
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
