"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { abbreviateAddress, formatRelativeTime } from "@/lib/ui/format";

interface OwnScreen {
  risk: "low" | "medium" | "high" | "sanctions";
  decision: "allow" | "review" | "reject";
  provider: string;
  createdAt: string;
}

interface ReviewRow {
  id: string;
  address: string;
  invoiceId: string;
  ticketId: string | null;
  risk: "medium" | "high" | "low" | "sanctions";
  decision: "review";
  createdAt: string;
  invoiceAmountOut: string;
  invoicePayoutToken: string;
  invoiceStatus: string;
}

interface ComplianceData {
  merchant: { address: string; payoutToken: string } | null;
  ownScreen: OwnScreen | null;
  reviewQueue: ReviewRow[];
}

export default function CompliancePage() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/merchant/compliance")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="px-6 md:px-10 py-8 md:py-10 max-w-5xl">
        <div className="h-8 w-40 rounded bg-[var(--surface-3)] animate-pulse" />
      </main>
    );
  }

  if (!data?.merchant) {
    return (
      <main className="px-6 md:px-10 py-8 md:py-10 max-w-5xl space-y-6">
        <h1 className="disp text-[30px] font-medium">Compliance</h1>
        <p className="lead text-sm">
          Set up a merchant profile in <Link href="/m/settings" className="text-[var(--action)] underline">Settings</Link> first.
        </p>
      </main>
    );
  }

  const own = data.ownScreen;
  const queue = data.reviewQueue;

  return (
    <main className="px-6 md:px-10 py-8 md:py-10 pb-20 max-w-5xl">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--border)] pb-[18px] mb-[26px]">
        <div>
          <div className="eyebrow eyebrow--acc mb-2.5">Sanctioned-wallet screening</div>
          <h1 className="disp text-[30px] font-medium m-0">Compliance</h1>
          <div className="mono text-[11px] text-[var(--fg-3)] mt-2 tracking-[.04em]">
            Wallet screening for your account + held customer payments · rejects flow through Arcora support
          </div>
        </div>
      </div>

      <section className="space-y-3 mb-[30px]">
        <h2 className="eyebrow">Your account</h2>
        <div className="card p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="eyebrow text-[9.5px] mb-1.5">Payout address</div>
            <div className="mono text-sm text-[var(--fg-2)]">{abbreviateAddress(data.merchant.address)}</div>
          </div>
          <div className="text-right">
            {own ? (
              <>
                <RiskChip risk={own.risk} />
                <div className="mono text-[10.5px] text-[var(--fg-3)] mt-1.5">
                  {providerLabel(own.provider)} · {formatRelativeTime(own.createdAt)}
                </div>
              </>
            ) : (
              <span className="tagchip tagchip--mut">Not yet screened</span>
            )}
          </div>
        </div>
        {own?.decision === "reject" && (
          <p className="text-xs text-[var(--danger)]">
            Your payout address has been blocked. Contact <a className="underline" href="mailto:compliance@arcorapay.xyz">compliance@arcorapay.xyz</a> to resolve.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">
          Customer reviews ({queue.length})
        </h2>
        {queue.length === 0 ? (
          <p className="mono text-xs text-[var(--fg-3)]">No customer payments are currently held for review.</p>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Invoice</th>
                    <th>Risk</th>
                    <th>Ticket</th>
                    <th className="text-right">Held</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((row) => (
                    <tr key={row.id}>
                      <td className="mono text-[var(--fg-2)]">{abbreviateAddress(row.address)}</td>
                      <td className="mono text-xs">
                        <Link href={`/i/${row.invoiceId}` as any} className="text-[var(--action)] hover:underline">
                          {row.invoiceId.slice(0, 10)}…
                        </Link>
                      </td>
                      <td><RiskChip risk={row.risk} /></td>
                      <td className="mono text-xs text-[var(--fg-2)]">{row.ticketId ?? "—"}</td>
                      <td className="mono text-right text-[11.5px] text-[var(--fg-3)]">
                        {formatRelativeTime(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "noop":     return "Testnet shadow screening";
    case "elliptic": return "Elliptic";
    case "trmlabs":  return "TRM Labs";
    default:         return provider;
  }
}

function RiskChip({ risk }: { risk: OwnScreen["risk"] }) {
  if (risk === "low") {
    return <span className="tagchip tagchip--ok">low</span>;
  }
  if (risk === "medium") {
    return (
      <span
        className="tagchip"
        style={{
          background: "var(--warning-bg)",
          color: "var(--warning)",
          borderColor: "color-mix(in oklch, var(--warning) 30%, transparent)",
        }}
      >
        medium
      </span>
    );
  }
  return (
    <span
      className="tagchip"
      style={{
        background: "var(--danger-bg)",
        color: "var(--danger)",
        borderColor: "color-mix(in oklch, var(--danger) 30%, transparent)",
      }}
    >
      {risk}
    </span>
  );
}
