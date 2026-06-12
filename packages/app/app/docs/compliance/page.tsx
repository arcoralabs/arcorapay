import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Compliance posture · Arcorapay docs",
  description: "Sanctions screening (Plan-5) and merchant KYB (Plan-8) — what's live, what's pending, what flips at mainnet.",
};

export default function ComplianceDocs() {
  return (
    <DocsShell
      currentPath="/docs/compliance"
      title="Compliance posture"
      description="Sanctions screening (Plan-5) and merchant KYB (Plan-8) — what's live, what's pending, what flips at mainnet."
    >
      <p>
        Arcora has two compliance layers. Both are off-chain by design — on-chain blocklists are gas-expensive, slow, and
        bypass the merchant relationship. Card processors work the same way.
      </p>

      <h2>Sanctions screening (Plan-5)</h2>
      <p>Live in shadow mode on testnet. Two checkpoints:</p>
      <ol>
        <li><strong><code>POST /api/invoices</code></strong> — when a merchant creates an invoice, Arcora screens the merchant&apos;s payout address (<code>flow=merchant_payout</code>).</li>
        <li><strong><code>POST /api/checkout/authorize</code></strong> — when a customer connects their wallet at the hosted checkout, Arcora screens the customer&apos;s address (<code>flow=customer_pay</code>) before the Pay button is enabled.</li>
      </ol>

      <h3>Provider adapters</h3>
      <p>Three implementations behind one interface:</p>
      <ul>
        <li><code>NoopProvider</code> — always <code>low</code>. Default on testnet; nothing is blocked.</li>
        <li><code>EllipticProvider</code> — Elliptic Lens API.</li>
        <li><code>TRMLabsProvider</code> — TRM Labs Forensics API.</li>
      </ul>
      <p>
        Selection via env (<code>COMPLIANCE_PROVIDER=noop|elliptic|trmlabs</code>). At mainnet T-0, flip to a real adapter
        and provide the API key — no code change.
      </p>

      <h3>Decision matrix</h3>
      <table>
        <thead><tr><th>Risk</th><th>Decision</th><th>UI</th></tr></thead>
        <tbody>
          <tr><td><code>low</code></td><td><code>allow</code></td><td>Pay button enabled</td></tr>
          <tr><td><code>medium</code></td><td><code>review</code></td><td>Disabled; review banner with <code>ticketId</code>, merchant gets a <code>compliance.review_queued</code> webhook</td></tr>
          <tr><td><code>high</code></td><td><code>reject</code></td><td>Disabled; neutral &quot;this wallet can&apos;t be used&quot; copy</td></tr>
          <tr><td><code>sanctions</code></td><td><code>reject</code></td><td>Same. Internal log records the OFAC/EU list match.</td></tr>
        </tbody>
      </table>

      <h3>Cache + retention</h3>
      <ul>
        <li>Read-through cache by <code>(address, flow)</code>. TTL 24h on stable risk, 1h on customer_pay flows in Phase 2+.</li>
        <li><code>compliance_screenings</code> audit table retains every screen. Sanctions hits 7 years; non-flagged 13 months.</li>
      </ul>

      <h2>Merchant KYB (Plan-8)</h2>
      <p>Spec&apos;d, not yet built. Two-track strategy:</p>
      <ul>
        <li><strong><code>ManualKybProvider</code></strong> (today, $0) — daily cron pulls free OFAC SDN + EU Consolidated lists into Postgres; entity + UBO names checked via <code>pg_trgm</code>; doc upload to Vercel Blob; ops manual review on <code>/m/admin/kyb</code>.</li>
        <li><strong><code>PersonaProvider</code></strong> (post-revenue) — Persona&apos;s Cases API, automated UBO + sanctions, HMAC-signed webhooks. Free unlimited sandbox, production billing per verification.</li>
      </ul>
      <p>Adapter swap is env-flip, no code change.</p>

      <h3>Workflow</h3>
      <pre><code>{`entity form → vendor session → green / yellow / red
  green → Plan-5 payout screen → ToS sign → on-chain registerMerchant → active
  yellow / red → /m/admin/kyb queue → ops decision → approved or rejected`}</code></pre>

      <h3>Jurisdictions</h3>
      <ul>
        <li><strong>OFAC + EU</strong> sanctions lists day-one. UN/UK optional via vendor flag.</li>
        <li><strong>TR-incorporated merchants rejected at the policy layer</strong> — domestic crypto-payment ban as of 2026. TR-resident UBOs of non-TR entities still get screened normally.</li>
      </ul>

      <h2>Reporting a suspected issue</h2>
      <p>
        <code>compliance@arcorapay.xyz</code>. We aim to respond within 24 hours. See{" "}
        <a href="https://github.com/arcoralabs/arcorapay/blob/HEAD/SECURITY.md">SECURITY.md</a> for security disclosures.
      </p>
    </DocsShell>
  );
}
