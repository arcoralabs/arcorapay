import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { invoices, merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { abbreviateAddress } from "@/lib/ui/format";
import { ArcoraSymbol, ArcoraLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { InvoiceCard } from "@/components/checkout/InvoiceCard";
import CheckoutClient from "./CheckoutClient";

export default async function CheckoutPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const rows = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      payInToken: invoices.payInToken,
      amountOut: invoices.amountOut,
      expiresAt: invoices.expiresAt,
      successUrl: invoices.successUrl,
      cancelUrl: invoices.cancelUrl,
      payoutToken: invoices.payoutToken,
      metadata: invoices.metadata,
      merchantAddress: merchants.address,
      // Audit H1 (2026-05-05): server-rendered checkout passes the merchant's
      // current allowlist into the client so the SuccessScreen can re-check
      // before window.location.href = successUrl. The list is intentionally
      // not a secret — it's an allowlist of acceptable redirect targets.
      merchantAllowedOrigins: merchants.allowedOrigins,
    })
    .from(invoices)
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (rows.length === 0) notFound();
  const inv = rows[0]!;
  const expired = inv.expiresAt.getTime() < Date.now();
  const initialStatus = expired && inv.status === "created" ? "expired" : inv.status;
  const payable = initialStatus === "created";

  return (
    <main className="relative min-h-screen bg-[var(--bg)]">
      <div className="page-bg" aria-hidden />

      <div className="relative z-[1] mx-auto w-full max-w-[480px] px-4 py-8 sm:py-12 flex flex-col gap-5">
        {/* Brand row */}
        <header className="flex items-center justify-between gap-3">
          <ArcoraLogo size={22} />
          <div className="flex items-center gap-3">
            <span className="mono hidden sm:inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.1em] text-[var(--fg-3)]">
              <span className="dot dot--live" aria-hidden />
              Secure checkout · Permit2
            </span>
            <ThemeToggle />
          </div>
        </header>

        {/* Checkout panel */}
        <div className="card overflow-hidden shadow-[var(--elev-4)]">
          {/* Merchant header row */}
          <div className="px-5 sm:px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-sunken)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <ArcoraSymbol size={28} aria-hidden />
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[var(--fg-1)] truncate">
                  {abbreviateAddress(inv.merchantAddress)}
                </div>
                <div className="mono text-[11px] text-[var(--fg-3)]">
                  {payable ? "awaiting payment" : initialStatus}
                </div>
              </div>
            </div>
            <span className="tagchip tagchip--mut">inv {inv.id.slice(0, 8)}…</span>
          </div>

          <div className="px-5 sm:px-6 py-6 flex flex-col gap-6">
            <InvoiceCard
              amountOut={inv.amountOut}
              payoutTokenAddress={inv.payoutToken}
              payInTokenAddress={inv.payInToken}
              status={initialStatus}
              expiresAt={inv.expiresAt}
              merchantAddress={inv.merchantAddress}
              metadata={inv.metadata}
            />

            <CheckoutClient
              invoiceId={inv.id}
              initialStatus={initialStatus}
              payInTokenAddress={inv.payInToken}
              payoutTokenAddress={inv.payoutToken}
              amountOut={inv.amountOut}
              successUrl={inv.successUrl}
              cancelUrl={inv.cancelUrl ?? undefined}
              allowedOrigins={inv.merchantAllowedOrigins ?? []}
            />
          </div>
        </div>

        <p className="mono text-center text-[10.5px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
          Gas-less Permit2 / EIP-712 · settles on Arc
        </p>
        <p className="mono text-center text-[10.5px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
          <a href="/terms" className="hover:text-[var(--fg-2)] transition-colors">Terms</a>
          {" · "}
          <a href="/privacy" className="hover:text-[var(--fg-2)] transition-colors">Privacy</a>
        </p>
      </div>
    </main>
  );
}
