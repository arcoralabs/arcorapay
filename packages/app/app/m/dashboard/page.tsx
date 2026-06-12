"use client";

import { useEffect, useMemo, useState } from "react";
import { InvoiceTable, type InvoiceRow } from "@/components/merchant/InvoiceTable";
import { CreateInvoiceDialog } from "@/components/merchant/CreateInvoiceDialog";
import { MerchantActivationCard } from "@/components/merchant/MerchantActivationCard";
import { symbolForAddress } from "@/lib/ui/format";

type DashboardData = {
  merchant: { address: string; payoutToken: string; webhookUrl: string | null } | null;
  invoices: InvoiceRow[];
};

type Range = "1d" | "7d" | "30d" | "All";
const RANGES: Range[] = ["1d", "7d", "30d", "All"];
const RANGE_DAYS: Record<Range, number | null> = { "1d": 1, "7d": 7, "30d": 30, All: null };

const PAID_STATUSES = new Set(["paid", "claimed", "recovered"]);

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>({ merchant: null, invoices: [] });
  const [range, setRange] = useState<Range>("30d");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function refresh() {
    setFetchError(null);
    try {
      const res = await fetch("/api/merchant");
      if (!res.ok) {
        setFetchError(res.status === 401 ? "auth_expired" : `fetch_failed_${res.status}`);
        return;
      }
      const json = await res.json();
      setData({ merchant: json.merchant, invoices: json.invoices ?? [] });
    } catch (e) {
      setFetchError("network");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  if (loading) {
    return (
      <main className="px-6 md:px-10 py-10 max-w-6xl mx-auto">
        <div className="h-8 w-40 rounded bg-[var(--surface-3)] animate-pulse" />
      </main>
    );
  }

  if (fetchError) {
    return (
      <main className="px-6 md:px-10 py-10 max-w-6xl mx-auto space-y-6">
        <h1 className="disp text-[30px] font-medium">Overview</h1>
        <div className="rounded-[var(--radius-field)] border border-[color-mix(in_oklch,var(--warning)_40%,transparent)] bg-[var(--warning-bg)] p-4 text-sm text-[var(--fg-1)]">
          <div className="font-semibold mb-1">Couldn&apos;t load your dashboard</div>
          {fetchError === "auth_expired"
            ? <>Your session has expired. <a href="/m/login" className="text-[var(--action)] underline">Sign in again</a>.</>
            : <>This is usually a transient network blip — retry, or check your connection.</>}
          {fetchError !== "auth_expired" && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => { setLoading(true); void refresh(); }}
                className="pill pill--ghost pill--sm"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  if (!data.merchant) {
    return (
      <main className="px-6 md:px-10 py-10 max-w-6xl mx-auto space-y-6">
        <h1 className="disp text-[30px] font-medium">Welcome</h1>
        <p className="lead text-sm">
          You&apos;re signed in but no merchant profile yet — finish onboarding in{" "}
          <a href="/m/settings" className="text-[var(--action)] underline">Settings</a>.
        </p>
      </main>
    );
  }

  const payoutSymbol = symbolForAddress(data.merchant.payoutToken);
  const fiatSign = payoutSymbol === "EURC" ? "€" : "$";

  return (
    <main className="px-6 md:px-10 py-8 md:py-10 pb-20 max-w-[1240px]">
      <Header range={range} setRange={setRange} payoutSymbol={payoutSymbol} />

      <div className="mb-[18px]">
        <MerchantActivationCard
          payoutAddress={data.merchant.address}
          payoutToken={data.merchant.payoutToken}
        />
      </div>

      <KpiGrid invoices={data.invoices} range={range} fiatSign={fiatSign} />

      <div className="m-2col grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 my-4 mb-[18px]">
        <VolumeChart invoices={data.invoices} range={range} fiatSign={fiatSign} payoutSymbol={payoutSymbol} />
        <NewInvoiceCard onCreated={refresh} />
      </div>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--border)]">
          <span className="eyebrow">Recent payments</span>
          <CreateInvoiceDialog apiKey={null} onCreated={refresh} />
        </div>
        <div className="overflow-x-auto">
          <InvoiceTable
            invoices={data.invoices}
            payoutToken={data.merchant.payoutToken}
            onChange={refresh}
          />
        </div>
      </section>
    </main>
  );
}

/* ---------- Header ---------- */
function Header({ range, setRange, payoutSymbol }: { range: Range; setRange: (r: Range) => void; payoutSymbol: string }) {
  const today = new Date();
  const daysBack = RANGE_DAYS[range];
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // "All" → null daysBack. The dashboard returns all invoices regardless of
  // range; the header just renders a different period label so the user
  // doesn't see "May 21 – May 21" for the "All" view.
  const periodLabel =
    daysBack === null
      ? `All time · ${today.getFullYear()}`
      : `${fmt(new Date(today.getTime() - daysBack * 86400_000))} – ${fmt(today)}, ${today.getFullYear()}`;

  return (
    <div className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--border)] pb-[18px] mb-[26px]">
      <div>
        <h1 className="disp text-[30px] font-medium m-0">Overview</h1>
        <div className="mono text-[11px] text-[var(--fg-3)] mt-2 tracking-[.04em]">
          {periodLabel} · settling in {payoutSymbol} · merchant of record
        </div>
      </div>
      <div className="seg">
        {RANGES.map(p => (
          <button
            key={p}
            type="button"
            aria-pressed={range === p}
            onClick={() => setRange(p)}
            className={range === p ? "on" : ""}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- KPI grid ---------- */
function filterByRange(invoices: InvoiceRow[], range: Range): InvoiceRow[] {
  const days = RANGE_DAYS[range];
  if (days === null) return invoices;
  const cutoff = Date.now() - days * 86400_000;
  return invoices.filter(i => new Date(i.createdAt).getTime() >= cutoff);
}

function KpiGrid({ invoices, range, fiatSign }: { invoices: InvoiceRow[]; range: Range; fiatSign: string }) {
  const kpis = useMemo(() => {
    const filtered = filterByRange(invoices, range);
    const paid = filtered.filter(i => PAID_STATUSES.has(i.status));
    const refunded = filtered.filter(i => i.status === "refunded").length;
    const totalUnits = paid.reduce((s, i) => s + BigInt(i.amountOut || "0"), 0n);
    // Audit #33: `Number(totalUnits)/1e6` loses precision above 2^53 micro-
    // units (~9.0 × 10^15 = $9Q). Not practically reachable, but stay
    // consistent with the BigInt arithmetic everywhere else in the codebase
    // by truncating to cents in BigInt space first; only then promote.
    const totalCents  = totalUnits / 10_000n;
    const totalAmount = Number(totalCents) / 100;
    const count = paid.length;
    const avg = count > 0 ? totalAmount / count : 0;
    const denom = paid.length + refunded;
    const refundPct = denom > 0 ? (refunded / denom) * 100 : 0;

    const fmtMoney = (n: number) =>
      `${fiatSign}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return [
      { l: "Volume",     v: fmtMoney(totalAmount) },
      { l: "Payments",   v: count.toLocaleString() },
      { l: "Avg ticket", v: fmtMoney(avg) },
      { l: "Refunds",    v: `${refundPct.toFixed(2)}%`, neutral: true },
    ];
  }, [invoices, range, fiatSign]);

  return (
    <div className="m-kpis">
      {kpis.map(k => (
        <div key={k.l} className="card lift p-[18px]">
          <span className="eyebrow">{k.l}</span>
          <div className="mono text-[26px] font-medium tracking-[-0.02em] mt-2 leading-none">
            {k.v}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Volume chart (SVG area) ---------- */
function VolumeChart({
  invoices,
  range,
  fiatSign,
  payoutSymbol,
}: {
  invoices: InvoiceRow[];
  range: Range;
  fiatSign: string;
  payoutSymbol: string;
}) {
  const { points, total, days } = useMemo(() => {
    const dayCount = RANGE_DAYS[range] ?? Math.max(30, daysSinceFirst(invoices));
    const buckets = new Array<number>(dayCount).fill(0);
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const startMs = now.getTime() - (dayCount - 1) * 86400_000;
    for (const inv of invoices) {
      if (!PAID_STATUSES.has(inv.status)) continue;
      const t = new Date(inv.createdAt).getTime();
      if (t < startMs) continue;
      const idx = Math.floor((t - startMs) / 86400_000);
      if (idx < 0 || idx >= dayCount) continue;
      const prev = buckets[idx] ?? 0;
      buckets[idx] = prev + Number(BigInt(inv.amountOut || "0")) / 1e6;
    }
    const total = buckets.reduce((s, v) => s + v, 0);
    return { points: buckets, total, days: dayCount };
  }, [invoices, range]);

  const W = 700;
  const H = 200;
  const max = Math.max(...points, 1) * 1.15;
  const xAt = (i: number) => (days === 1 ? W / 2 : (i / (days - 1)) * W);
  const yAt = (v: number) => H - (v / max) * H;
  const linePts = points.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" L ");
  const areaPath = points.length > 0
    ? `M 0,${H} L ${linePts} L ${W},${H} Z`
    : "";

  return (
    <div className="card p-6">
      <div className="flex justify-between items-baseline mb-2">
        <div>
          <span className="eyebrow">Volume · {range}</span>
          <div className="mono text-[22px] mt-1 font-medium">
            {fiatSign}
            {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <span className="mono inline-flex items-center gap-[7px] text-[12px] text-[var(--fg-3)]">
          <span className="w-2 h-2 rounded-[2px] bg-[var(--acc)]" />
          {payoutSymbol}
        </span>
      </div>
      {total === 0 ? (
        <div className="h-[220px] flex items-center justify-center text-[var(--fg-3)] text-sm">
          No paid invoices in this range yet.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-[220px] overflow-visible"
          aria-label={`${payoutSymbol} volume over the last ${days} days`}
        >
          <defs>
            <linearGradient id="arcora-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[1, 2, 3].map(i => (
            <line
              key={i}
              x1="0"
              y1={(H / 4) * i}
              x2={W}
              y2={(H / 4) * i}
              stroke="var(--border)"
              strokeWidth="0.5"
            />
          ))}
          <path d={areaPath} fill="url(#arcora-area)" />
          <path
            d={`M ${linePts}`}
            fill="none"
            stroke="var(--acc)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {(() => {
            const last = points[points.length - 1] ?? 0;
            return days > 1 && last > 0 ? (
              <circle cx={W} cy={yAt(last)} r="4" fill="var(--acc)" />
            ) : null;
          })()}
        </svg>
      )}
    </div>
  );
}

function daysSinceFirst(invoices: InvoiceRow[]): number {
  if (invoices.length === 0) return 30;
  const first = invoices.reduce(
    (min, i) => Math.min(min, new Date(i.createdAt).getTime()),
    Date.now()
  );
  return Math.max(1, Math.ceil((Date.now() - first) / 86400_000));
}

/* ---------- Right-rail card: quick action ---------- */
function NewInvoiceCard({ onCreated }: { onCreated: () => void }) {
  return (
    <div className="card p-6 flex flex-col">
      <span className="eyebrow">Quick actions</span>
      <p className="lead text-[13px] mt-2">
        Create an invoice and share the checkout link or QR with your customer.
      </p>
      <div className="mt-auto pt-4">
        <CreateInvoiceDialog apiKey={null} onCreated={onCreated} fullWidth />
      </div>
    </div>
  );
}
