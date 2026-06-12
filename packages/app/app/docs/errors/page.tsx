import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Error reference · Arcorapay docs",
  description: "Every error code Arcora returns, what triggers it, and how to recover.",
};

export default function ErrorsDocs() {
  return (
    <DocsShell
      currentPath="/docs/errors"
      title="Error reference"
      description="Every error code Arcora returns, what triggers it, and how to recover."
    >
      <h2>API errors</h2>
      <table>
        <thead><tr><th>HTTP</th><th>Code</th><th>Meaning</th><th>Recovery</th></tr></thead>
        <tbody>
          <tr><td>400</td><td><code>bad_body</code> / <code>bad_params</code></td><td>Request shape rejected by Zod.</td><td>Fix payload; <code>details</code> has the violations.</td></tr>
          <tr><td>400</td><td><code>permit_expired</code></td><td>Permit2 deadline past at checkout submit.</td><td>Refresh quote, re-sign.</td></tr>
          <tr><td>401</td><td><code>missing_api_key</code></td><td><code>X-Arcora-Api-Key</code> header missing.</td><td>Add the header.</td></tr>
          <tr><td>401</td><td><code>invalid_api_key</code></td><td>Header present but unrecognised.</td><td>Rotate key at <code>/m/settings</code>.</td></tr>
          <tr><td>401</td><td><code>unauthorized</code></td><td>SIWE session missing or expired (merchant routes).</td><td>Re-auth at <code>/m/login</code>.</td></tr>
          <tr><td>403</td><td><code>MERCHANT_PAYOUT_BLOCKED</code></td><td>Merchant&apos;s payout address flagged sanctions/high in Plan-5 screen.</td><td>Resolve via <code>compliance@arcorapay.xyz</code>.</td></tr>
          <tr><td>404</td><td><code>invoice_not_found</code></td><td><code>invoiceId</code> not in DB.</td><td>Check id; create the invoice first.</td></tr>
          <tr><td>409</td><td><code>invoice_not_payable</code></td><td>Status is <code>paid</code>, <code>expired</code>, <code>refunded</code>, or <code>failed</code>.</td><td>Don&apos;t retry. Refund needs a different path.</td></tr>
          <tr><td>410</td><td><code>invoice_expired</code></td><td><code>expiresAt</code> past at submit.</td><td>Create a new invoice.</td></tr>
          <tr><td>412</td><td><code>delegate_not_authorized</code></td><td>Server hot wallet&apos;s authorization expired. Ops must re-authorize.</td><td>Contact ops.</td></tr>
          <tr><td>502</td><td><code>chain_error</code></td><td>On-chain tx reverted.</td><td>Read <code>detail</code> for the short revert reason.</td></tr>
          <tr><td>503</td><td><code>compliance_unavailable</code> / <code>PROVIDER_UNAVAILABLE</code></td><td>Provider returned 5xx, fail-closed config.</td><td>Wait, retry.</td></tr>
        </tbody>
      </table>

      <h2>Compliance decisions (<code>/api/checkout/authorize</code>)</h2>
      <table>
        <thead><tr><th>Decision</th><th>Code</th><th>UI behavior</th></tr></thead>
        <tbody>
          <tr><td><code>allow</code></td><td>n/a</td><td>Pay button enabled</td></tr>
          <tr><td><code>review</code></td><td>n/a</td><td>Pay button disabled, show review banner with <code>ticketId</code></td></tr>
          <tr><td><code>reject</code></td><td><code>SANCTIONED_WALLET</code></td><td>Pay button disabled, neutral copy</td></tr>
          <tr><td><code>reject</code></td><td><code>HIGH_RISK_WALLET</code></td><td>Pay button disabled, neutral copy</td></tr>
          <tr><td><code>reject</code></td><td><code>PROVIDER_UNAVAILABLE</code></td><td>Treated as transient — UI shows &quot;try again shortly&quot;</td></tr>
        </tbody>
      </table>

      <h2>On-chain errors (gateway reverts)</h2>
      <p>These show up in <code>chain_error.detail</code> and in the explorer. ABI-decoded names:</p>
      <table>
        <thead><tr><th>Selector</th><th>Trigger</th></tr></thead>
        <tbody>
          <tr><td><code>MerchantAlreadyRegistered</code></td><td><code>registerMerchant</code> called twice from the same wallet.</td></tr>
          <tr><td><code>MerchantInactive</code></td><td>Merchant deactivated; new invoices reject.</td></tr>
          <tr><td><code>InvalidPayoutToken</code></td><td>Token not in <code>supportedTokens</code>.</td></tr>
          <tr><td><code>InvalidPayoutAddress</code></td><td>Zero address in <code>registerMerchant</code> / constructor.</td></tr>
          <tr><td><code>InvalidPayInToken</code></td><td>Token not whitelisted; <code>createInvoice</code> reverts.</td></tr>
          <tr><td><code>InvoiceAlreadyExists(globalId)</code></td><td>Duplicate <code>merchantInvoiceId</code> for the same merchant.</td></tr>
          <tr><td><code>InvoiceAlreadyPaid(globalId)</code></td><td><code>settleInvoice</code> re-attempted after settlement.</td></tr>
          <tr><td><code>InvoiceExpired(globalId)</code></td><td><code>settleInvoice</code> past <code>expiresAt</code>.</td></tr>
          <tr><td><code>InvoiceNotFound(globalId)</code></td><td>Invoice doesn&apos;t exist.</td></tr>
          <tr><td><code>InvoiceNotInCreatedState(globalId)</code></td><td><code>recordPayerRefund</code> after settle.</td></tr>
          <tr><td><code>InvoiceNotRefundable(globalId)</code></td><td><code>refundInvoice</code> on a non-<code>Paid</code> invoice.</td></tr>
          <tr><td><code>PayoutShortfall(supplied, required)</code></td><td>App Kit returned less than <code>amountOut</code>.</td></tr>
          <tr><td><code>DelegateNotAuthorized</code></td><td><code>createInvoiceFor</code> from an unauthorized address.</td></tr>
          <tr><td><code>InsufficientFeesForRefund(required, accrued)</code></td><td>Fee bucket drained before refund.</td></tr>
        </tbody>
      </table>
    </DocsShell>
  );
}
