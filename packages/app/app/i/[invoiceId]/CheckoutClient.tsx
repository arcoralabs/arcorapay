"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { ConnectButton } from "thirdweb/react";
import { createThirdwebClient } from "thirdweb";
import { QuoteDisplay } from "@/components/checkout/QuoteDisplay";
import { PayButton } from "@/components/checkout/PayButton";
import { ChainSelector } from "@/components/checkout/ChainSelector";
import { CrossChainPayButton } from "@/components/checkout/CrossChainPayButton";
import { SuccessScreen, ExpiredScreen } from "@/components/checkout/StatusScreens";
import { MobileWalletQR } from "@/components/checkout/MobileWalletQR";
import { Smartphone } from "lucide-react";
import type { Address } from "viem";
import type { invoiceStatus } from "@/lib/db/schema";

const thirdwebClient = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? "",
});

/** Mirrors the DB `invoice_status` enum (type-only import — drizzle never
 *  reaches the client bundle). All 7 states, not just the happy-path 4:
 *  a refunded/claimed/recovered invoice must never render as payable. */
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];

/** Every non-`created` state is terminal for the 3s poll. */
const TERMINAL_STATUSES: readonly InvoiceStatus[] =
  ["paid", "expired", "failed", "refunded", "claimed", "recovered"];

interface CheckoutClientProps {
  invoiceId: string;
  initialStatus: InvoiceStatus;
  payInTokenAddress: string;
  payoutTokenAddress: string;
  amountOut: string;
  successUrl: string;
  cancelUrl?: string;
  /** Merchant-declared allowlist of origins that may receive customers post-
   *  payment. Defense-in-depth in the browser; server already enforces the
   *  same list at invoice-create. Audit H1 (2026-05-05). */
  allowedOrigins: readonly string[];
}

export default function CheckoutClient(props: CheckoutClientProps) {
  const { resolvedTheme } = useTheme();
  const [status, setStatus] = useState(props.initialStatus);
  // QuoteDisplay quotes the forward direction: the customer commits to a
  // payIn upfront and the relayer's kit.swap converts it; the merchant gets
  // >= amountOut or the settle reverts. The custody-escrow gateway address
  // is selected server-side from the invoice's stored gateway address — the
  // checkout UI is gateway-agnostic.
  const [amountIn, setAmountIn]     = useState<bigint | null>(null);
  const [quoteStale, setQuoteStale] = useState(false);
  const [showQR, setShowQR]         = useState(false);
  const [sourceChainId, setSourceChainId] = useState(84532); // Base Sepolia default

  // Cross-chain checkout only applies when the invoice's payIn token is Arc
  // USDC (the prepare endpoint 409s with crosschain_requires_arc_usdc_payin
  // otherwise), so gate on both the env flag and the payIn token.
  const crosschainEnabled =
    process.env.NEXT_PUBLIC_CROSSCHAIN_ENABLED === "true" &&
    props.payInTokenAddress.toLowerCase() ===
      (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "").toLowerCase();

  useEffect(() => {
    if (status !== "created") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/invoices/${props.invoiceId}`);
      const data = await res.json();
      // Any terminal state stops the poll: setStatus re-runs this effect,
      // which bails out above and clears the interval. Previously only
      // paid/expired/failed terminated, so refunded/claimed/recovered
      // invoices polled forever and stayed on the payable screen.
      if (TERMINAL_STATUSES.includes(data.status)) setStatus(data.status as InvoiceStatus);
    }, 3000);
    return () => clearInterval(t);
  }, [status, props.invoiceId]);

  // claimed/recovered are custody-escrow settlements — the payer's view is
  // the same as paid, so they render the success family.
  if (status === "paid" || status === "claimed" || status === "recovered") {
    return <SuccessScreen successUrl={props.successUrl} allowedOrigins={props.allowedOrigins} />;
  }
  if (status === "expired" || status === "failed" || status === "refunded") {
    return <ExpiredScreen variant={status} cancelUrl={props.cancelUrl} allowedOrigins={props.allowedOrigins} />;
  }

  if (showQR) {
    return <MobileWalletQR url={typeof window !== "undefined" ? window.location.href : ""} onBack={() => setShowQR(false)} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <QuoteDisplay
        payInTokenAddress={props.payInTokenAddress}
        payoutTokenAddress={props.payoutTokenAddress}
        amountOut={props.amountOut}
        onQuote={(_out, payIn) => { setAmountIn(payIn); setQuoteStale(false); }}
        onStale={() => setQuoteStale(true)}
      />

      <div className="flex flex-col gap-3">
        {crosschainEnabled && (
          <ChainSelector value={sourceChainId} onChange={setSourceChainId} />
        )}

        <ConnectButton
          client={thirdwebClient}
          connectButton={{
            label: "Connect wallet",
            className: "pill pill--acc w-full",
            // thirdweb injects its own emotion styles after ours; inline
            // styles keep the accent pill colors authoritative in both themes.
            style: { background: "var(--acc)", color: "var(--acc-ink)" },
          }}
          theme={resolvedTheme === "light" ? "light" : "dark"}
        />

        {crosschainEnabled && (
          <div className="space-y-2">
            <CrossChainPayButton
              invoiceId={props.invoiceId}
              sourceChainId={sourceChainId}
              onPaid={() => setStatus("paid")}
              onFailed={() => setStatus("failed")}
            />
            <p className="text-[12px] text-[var(--fg-2)] leading-[1.55]">
              If bridging completes but settlement cannot proceed before a swap, any automatic refund is sent as USDC to this same address on Arc.
            </p>
            <p className="text-center text-[13px] text-[var(--fg-3)]">or pay directly on Arc</p>
          </div>
        )}

        <PayButton
          invoiceId={props.invoiceId}
          payInTokenAddress={props.payInTokenAddress as Address}
          payInAmount={amountIn}
          quoteStale={quoteStale}
          onPaid={() => setStatus("paid")}
          onFailed={() => setStatus("failed")}
        />

        <button
          type="button"
          onClick={() => setShowQR(true)}
          className="w-full inline-flex items-center justify-center gap-2 text-[13px] text-[var(--action)] hover:underline py-2"
        >
          <Smartphone className="size-4" /> Pay with mobile wallet
        </button>
      </div>

      {/* What you're signing — compact EIP-712 info panel */}
      <div className="field mt-2 overflow-hidden">
        <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
          <div className="p-4">
            <p className="eyebrow mb-2">What you&apos;re signing</p>
            <p className="text-[12px] text-[var(--fg-2)] leading-[1.55]">
              EIP-712{" "}
              <code className="mono text-[11px] text-[var(--fg-1)] bg-[var(--surface-3)] rounded-[4px] px-[4px] py-[1px]">
                PermitWitnessTransferFrom
              </code>
              . Witness binds to{" "}
              <code className="mono text-[11px] text-[var(--fg-1)] bg-[var(--surface-3)] rounded-[4px] px-[4px] py-[1px] break-all">
                {props.invoiceId}
              </code>{" "}
              and the Arcora relayer only. Signature cannot be replayed on another transaction.
            </p>
          </div>
          <div className="p-4">
            <p className="eyebrow mb-2">What happens next</p>
            <p className="text-[12px] text-[var(--fg-2)] leading-[1.55]">
              The relayer pulls funds via Permit2, runs the FX swap via Arc&apos;s App Kit, and delivers the merchant&apos;s preferred stablecoin. Under 30 seconds.
            </p>
          </div>
        </div>
      </div>

      {props.cancelUrl && (() => {
        // Audit H1 (2026-05-05): only render the cancel link when the merchant's
        // allowlist still contains its origin. Stale invoices keep the original
        // cancelUrl, so a merchant who later removes that origin shouldn't see
        // it remain clickable from the live checkout.
        try {
          const origin = new URL(props.cancelUrl).origin;
          if (!props.allowedOrigins.includes(origin)) return null;
        } catch { return null; }
        return (
          <div className="text-center pt-1">
            <a href={props.cancelUrl} className="text-[13px] text-[var(--fg-3)] hover:underline">Cancel</a>
          </div>
        );
      })()}
    </div>
  );
}
