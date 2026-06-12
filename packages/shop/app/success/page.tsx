"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/lib/cart";
import { CheckCircle2, Loader2 } from "lucide-react";
import { formatUsd } from "@/lib/format";

export default function SuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}

// Audit #40: Arcora invoice ids are bytes32 hex (66 chars incl. 0x prefix).
// Reject anything else so a crafted query param like
// `?invoice=REFUND_PENDING_CALL_+1...` can't be rendered as code/link text
// and social-eng the recipient. React already escapes text, so this is
// belt-and-braces.
const INVOICE_ID_RE = /^0x[0-9a-fA-F]{64}$/;

function SuccessInner() {
  const params = useSearchParams();
  const { clear } = useCart();
  const rawInvoiceId = params.get("invoice") ?? params.get("invoiceId");
  const invoiceId = rawInvoiceId && INVOICE_ID_RE.test(rawInvoiceId) ? rawInvoiceId : null;
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    // Clear once on mount so a refresh doesn't keep clearing repeatedly.
    if (!cleared) { clear(); setCleared(true); }
  }, [cleared, clear]);

  return (
    <main className="px-6 py-20 max-w-2xl mx-auto text-center">
      <CheckCircle2 className="size-14 text-arcora-teal mx-auto" />
      <h1 className="mt-6 font-[family-name:var(--font-display)] text-4xl font-semibold">Order received</h1>
      <p className="mt-3 text-arcora-muted-fg">
        Thanks — your stablecoin payment is settling on Arc right now. We&apos;ll email a confirmation
        as soon as the relayer finishes the swap and pays the merchant.
      </p>

      {invoiceId && (
        <div className="mt-8 rounded-2xl border border-arcora-border bg-white p-5 text-left">
          <div className="text-xs uppercase tracking-wider font-semibold text-arcora-muted-fg">Invoice id</div>
          <code className="block font-mono text-sm break-all mt-1">{invoiceId}</code>
          <a
            href={`https://arcorapay.xyz/i/${invoiceId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-arcora-link text-sm hover:underline mt-3 inline-block"
          >
            Track on arcorapay.xyz ↗
          </a>
        </div>
      )}

      <Link href="/" className="btn-pill mt-10 inline-flex">Back to shop</Link>
    </main>
  );
}
