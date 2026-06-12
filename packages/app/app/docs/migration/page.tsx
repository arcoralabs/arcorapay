import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Migration · v0.9 → v0.10 · Arcorapay docs",
  description: "How to move from v0.9 (refund-source binding) to v0.10 (custody escrow gateway).",
};

export default function MigrationDocs() {
  return (
    <DocsShell
      currentPath="/docs/migration"
      title="Migration · v0.9 → v0.10"
      description="How to move from v0.9 to v0.10 — the custody escrow gateway."
    >
      <p>
        The custody-escrow gateway is canonical since 2026-05-07. The current live deployment is
        <code>ArcFXGateway</code> at <code>0x07BAC123…aE3a3</code> (recorded in{" "}
        <code>packages/contracts/deployments/arc-testnet.json</code>). All earlier deployments
        (v0.6 — v1.1) remain on-chain (immutable) but are no longer watched — testnet was wiped
        on 2026-05-20. The escrow-model change documented below was the v0.9 → v0.10 migration.
      </p>

      <h2>What changed</h2>
      <table>
        <thead><tr><th></th><th>v0.9</th><th>v0.10</th></tr></thead>
        <tbody>
          <tr><td>Settlement target</td><td>Funds delivered directly to <code>merchants[m].payoutAddress</code></td><td>Funds held in per-invoice escrow inside the gateway</td></tr>
          <tr><td>Refund mechanism</td><td>Pulled from <code>payments[].payoutSource</code> via ERC-20 allowance</td><td>Drained from gateway escrow — no allowance dance</td></tr>
          <tr><td>Refund window</td><td>Indefinite (as long as merchant pre-approves)</td><td>7 days from settle (escrow drains on claim)</td></tr>
          <tr><td>Fee accrual</td><td>At settle</td><td>At claim — refunded invoices earn no protocol fee</td></tr>
          <tr><td>Merchant claim</td><td>n/a (auto-paid at settle)</td><td>Permissionless <code>claim(globalIds[])</code> after the 7-day window</td></tr>
          <tr><td>Delegate authorization</td><td><code>authorizeDelegate(delegate, expiresAt)</code></td><td><code>authorizeDelegate(delegate, expiresAt, rights)</code> with bit-flag scope (<code>RIGHT_CREATE_INVOICE | RIGHT_REFUND</code>)</td></tr>
          <tr><td>Reactivation</td><td>Implicit (deactivated merchants could re-register)</td><td>Admin-only <code>reactivateMerchant(addr)</code></td></tr>
          <tr><td>Fee bound</td><td>Off-chain only (deploy script <code>require</code>)</td><td>In-constructor <code>require(feeBps &lt;= 1000)</code></td></tr>
        </tbody>
      </table>

      <h2>Migration steps</h2>
      <h3>Merchants on the hosted checkout</h3>
      <ol>
        <li>Visit <code>/m/dashboard</code> → click <strong>Activate gateway →</strong> on the activation card.
            Sign one <code>registerMerchant(payoutAddress, payoutToken)</code> tx.</li>
        <li>Visit <code>/m/settings</code> → <strong>On-chain authorization</strong> →
            <strong>Authorize delegate</strong>. Sign one
            <code>authorizeDelegate(serverWallet, MAX_UINT64, RIGHT_CREATE_INVOICE)</code> tx.</li>
        <li>You&apos;re done. New invoices route to v0.10 automatically.</li>
      </ol>

      <h3>SDK users</h3>
      <pre><code>{`const arcora = new Arcora({
  apiKey: process.env.ARCORA_API_KEY,
});
// no engine arg — /api/invoices is v0.10-only`}</code></pre>
      <p>
        The SDK signature is unchanged; the legacy <code>?engine=</code> query param is gone.
        v0.10&apos;s ABI matches v0.9 for the client-side Permit2 flow, so no checkout changes are needed.
      </p>

      <h3>Webhooks</h3>
      <p>
        Payload shape unchanged. Two new event types ship with v0.10:
      </p>
      <ul>
        <li><code>invoice.claimed</code> — fires when the gateway releases the merchant&apos;s leg from escrow (after the 7-day window).</li>
        <li><code>invoice.recovered</code> — fires when admin sweeps escrow from a deactivated merchant after the 14-day floor.</li>
      </ul>

      <h2>The 7-day window in practice</h2>
      <p>
        After settle, the merchant&apos;s portion sits in gateway custody for 7 days before becoming
        claimable. During that window <code>refundInvoice(globalId)</code> drains the full escrow back
        to the customer with no on-chain time check — the &quot;window&quot; is enforced indirectly:
        once anyone calls <code>claim()</code>, the escrow is gone and refunds revert with
        <code>InvoiceNotRefundable</code>. So in practice merchants have until the first <code>claim()</code>
        runs to issue a refund. Late chargebacks beyond that need off-chain settlement.
      </p>
    </DocsShell>
  );
}
