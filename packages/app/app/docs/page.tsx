import Link from "next/link";
import type { Route } from "next";
import { DocsShell } from "@/components/docs/DocsShell";
import { FlowDiagram } from "@/components/docs/FlowDiagram";

export const metadata = {
  title: "Documentation · Arcorapay",
  description: "Developer documentation for Arcora — stablecoin checkout and settlement on Arc.",
};

export default function DocsIndex() {
  return (
    <DocsShell
      currentPath="/docs"
      title="Introduction"
      description="What Arcora is, where it fits, and how the pieces connect."
    >
      <p>
        Arcora is a stablecoin checkout and settlement platform on{" "}
        <a href="https://arc.network" target="_blank" rel="noopener noreferrer">Arc Network</a>. A merchant creates an
        invoice, the customer signs <strong>one</strong> EIP-712 message, and the merchant receives their preferred
        stablecoin within ~30 seconds — checkout-grade UX with on-chain settlement underneath.
      </p>

      <h2>Where Arcora fits</h2>
      <FlowDiagram />

      <p>
        The customer signs once. Arcora&apos;s relayer pulls the funds via Permit2, runs an FX swap on Circle&apos;s App Kit
        Swap if needed, and calls <code>settleInvoice</code> on the gateway to deliver the merchant&apos;s preferred
        stablecoin minus the protocol fee.
      </p>

      <h2>What you build with Arcora</h2>
      <ul>
        <li><strong>Hosted checkout</strong> — link out to <code>arcorapay.xyz/i/&#123;invoiceId&#125;</code>. Zero frontend code on your side.</li>
        <li><strong>Embedded checkout</strong> — drop <code>@arcora/sdk-react</code>&apos;s components into your own page.</li>
        <li><strong>API-only</strong> — call <code>POST /api/invoices</code>, render the link yourself, listen for <code>invoice.paid</code> webhooks.</li>
      </ul>

      <h2>Status</h2>
      <p>
        Arcora runs on <strong>Arc Testnet</strong> today. Mainnet is gated on Arc going mainnet itself; we&apos;ll flip
        with the network. Sanctions screening is in shadow mode on testnet — Noop adapter, audit logs only — and flips
        to a real provider via env at mainnet T-0.
      </p>
      <p>
        See <Link href={"/docs/quickstart" as Route}>Quickstart</Link> to integrate in ten minutes, or jump straight to
        the <Link href={"/docs/rest-api" as Route}>REST API reference</Link> if you already know the shape.
      </p>
    </DocsShell>
  );
}
