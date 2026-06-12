import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "REST API · Arcorapay docs",
  description: "Direct endpoints — create invoices, authorize checkouts, query state. Server-to-server.",
};

export default function RestApiDocs() {
  return (
    <DocsShell
      currentPath="/docs/rest-api"
      title="REST API"
      description="Direct endpoints — create invoices, authorize checkouts, query state. Server-to-server."
    >
      <p>The SDK is a thin wrapper over these. If you&apos;re not on Node, talk to the API directly.</p>
      <p><strong>Base URL</strong>: <code>https://arcorapay.xyz</code></p>
      <p><strong>Auth</strong>: API key in <code>X-Arcora-Api-Key</code> header. Created at <code>/m/settings</code>.</p>

      <h2><code>POST /api/invoices</code></h2>
      <p>Create an invoice and stage it on-chain.</p>
      <h3>Request</h3>
      <pre><code>{`POST /api/invoices HTTP/1.1
Content-Type: application/json
X-Arcora-Api-Key: ak_live_...

{
  "amountUsdc":  49.99,
  "payInToken":  "EURC",
  "successUrl":  "https://yourshop.com/order/123/success",
  "cancelUrl":   "https://yourshop.com/order/123/cancel",
  "metadata":    { "orderId": "123" }
}`}</code></pre>
      <p>
        Routes to the live custody-escrow gateway (<code>ArcFXGateway</code> at{" "}
        <code>0x07BAC123…aE3a3</code>). The legacy <code>?engine=</code> selector is gone
        (pre-cutover gateways retired); every invoice records the gateway address it was created
        against.
      </p>

      <h3>Response</h3>
      <pre><code>{`HTTP/1.1 201 Created

{
  "invoiceId": "0x4f3a...",
  "url":       "https://arcorapay.xyz/i/0x4f3a..."
}`}</code></pre>

      <h3>Error responses</h3>
      <table>
        <thead><tr><th>Status</th><th>Code</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>400</td><td><code>bad_body</code></td><td>Body shape rejected by Zod schema.</td></tr>
          <tr><td>401</td><td><code>missing_api_key</code> / <code>invalid_api_key</code></td><td>Header missing or unrecognised.</td></tr>
          <tr><td>403</td><td><code>MERCHANT_PAYOUT_BLOCKED</code></td><td>Plan-5 sanctions screen rejected the merchant payout address.</td></tr>
          <tr><td>412</td><td><code>delegate_not_authorized</code></td><td>Server hot wallet hasn&apos;t been authorized for <code>createInvoiceFor</code>.</td></tr>
          <tr><td>502</td><td><code>chain_error</code></td><td>On-chain tx reverted. <code>detail</code> carries the short message.</td></tr>
          <tr><td>503</td><td><code>compliance_unavailable</code></td><td>Compliance provider 5xx and <code>COMPLIANCE_FAIL_OPEN_FOR_INVOICE=false</code>.</td></tr>
        </tbody>
      </table>

      <h2><code>POST /api/checkout/authorize</code></h2>
      <p>
        Compliance gate — fired by the hosted checkout after the customer connects their wallet, before signing.
      </p>
      <h3>Request</h3>
      <pre><code>{`POST /api/checkout/authorize HTTP/1.1
Content-Type: application/json

{
  "invoiceId": "0x4f3a...",
  "address":   "0x3687d36e8b0fee06bcd935b6312ca5b59f8e4317"
}`}</code></pre>
      <h3>Response</h3>
      <pre><code>{`// allow
{ "decision": "allow", "screenedAt": "2026-05-03T...", "ttlSeconds": 86400 }

// review
{
  "decision":       "review",
  "ticketId":       "rev_abc...",
  "reason":         "Compliance review required — we'll email the merchant within 24h.",
  "supportContact": "compliance@arcorapay.xyz"
}

// reject (sanctions or high risk)
{
  "decision": "reject",
  "code":     "SANCTIONED_WALLET" | "HIGH_RISK_WALLET",
  "reason":   "This wallet can't be used for this payment."
}`}</code></pre>
      <p>On testnet the active provider is Noop — every wallet returns <code>allow</code>.</p>

      <h2><code>POST /api/checkout/submit</code></h2>
      <p>
        Customer-side Permit2 submission. The hosted checkout calls this once the customer signs; the relayer then drains the queue.
        You don&apos;t typically call this yourself unless building a non-hosted checkout.
      </p>
      <pre><code>{`{
  "invoiceId":         "0x...",
  "payer":             "0x...",
  "payInToken":        "0x...",
  "amountIn":          "49990000",
  "permit2Data":       { "nonce": "1", "deadline": "...", "witness": "0x...", "witnessTypeString": "..." },
  "permit2Signature":  "0x..."
}`}</code></pre>

      <h2><code>GET /api/checkout/status/&#123;submissionId&#125;</code></h2>
      <p>Poll the relayer queue for settlement state.</p>
      <pre><code>{`{
  "status":        "pending" | "processing" | "settled" | "refunded" | "failed",
  "settleTxHash": "0x..." | null,
  "refundTxHash": "0x..." | null,
  "error":         string | null
}`}</code></pre>

      <h2><code>POST /api/checkout/quote</code></h2>
      <p>
        Live quote from App Kit Swap on Arc. Used by hosted checkout. Supports two modes —
        <code>amountIn</code> for forward quotes (caller knows what they&apos;re paying), and
        <code>targetOutput</code> for reverse quotes (caller knows the merchant floor; the response
        carries the cushioned <code>amountIn</code> the customer should sign for).
      </p>
      <pre><code>{`POST /api/checkout/quote HTTP/1.1
Content-Type: application/json

{
  "payInToken":   "EURC",
  "payoutToken":  "USDC",
  "targetOutput": "49.99",
  "slippageBps":  250
}`}</code></pre>
      <h3>Response</h3>
      <pre><code>{`{
  "payInToken":      "EURC",
  "payoutToken":     "USDC",
  "amountIn":        "46.045679",
  "estimatedOutput": "49.99",
  "stopLimit":       "49.49",
  "fees":            [{ "token": "USDC", "amount": "0.5", "type": "providerFee" }],
  "ttlSeconds":      30,
  "issuedAt":        "2026-05-02T..."
}`}</code></pre>
      <p>
        The legacy <code>GET /api/quote?from&amp;to&amp;amountIn</code> endpoint reads the v0.6
        on-chain pool and is kept for read-only callers; new integrations should use
        <code>/api/checkout/quote</code>.
      </p>

      <h2><code>GET /api/merchant/treasury</code></h2>
      <p>Authenticated (SIWE session) merchant treasury rollup. Used by <code>/m/treasury</code>.</p>

      <h2><code>GET /api/merchant/compliance</code></h2>
      <p>
        Authenticated. Returns the merchant&apos;s own onboarding screen + customer review queue. Used by <code>/m/compliance</code>.
      </p>
    </DocsShell>
  );
}
