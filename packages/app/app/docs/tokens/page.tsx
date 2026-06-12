import { DocsShell } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Token reference · Arcorapay docs",
  description: "Supported stablecoins, contract addresses, App Kit aliases, and decimals.",
};

export default function TokensDocs() {
  return (
    <DocsShell
      currentPath="/docs/tokens"
      title="Token reference"
      description="Supported stablecoins, contract addresses, App Kit aliases, and decimals."
    >
      <h2>Today on Arc Testnet</h2>
      <p>Hosted checkout and the SDK accept these as <code>payInToken</code> and as merchant payout tokens:</p>
      <table>
        <thead><tr><th>Symbol</th><th>Address</th><th>Decimals</th><th>App Kit alias</th></tr></thead>
        <tbody>
          <tr><td>USDC</td><td><code>0x3600000000000000000000000000000000000000</code></td><td>6 (ERC-20) / 18 (native)</td><td><code>USDC</code></td></tr>
          <tr><td>EURC</td><td><code>0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a</code></td><td>6</td><td><code>EURC</code></td></tr>
        </tbody>
      </table>
      <p>
        USDC is also the gas token on Arc. The native balance uses 18 decimals; the ERC-20 interface (what dapps see)
        uses 6. Always read <code>decimals()</code> rather than assuming.
      </p>

      <h2>App Kit Swap support</h2>
      <p>
        Circle&apos;s App Kit Swap is what does the FX between pay-in and payout tokens. On <strong>Arc Testnet</strong> it
        supports only USDC ⇄ EURC today. On <strong>Arc Mainnet</strong> (when Arc launches it) the alias set expands:
      </p>
      <table>
        <thead><tr><th>Alias</th><th>Decimals</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><code>USDC</code></td><td>6</td><td>Native gas + canonical USD stable</td></tr>
          <tr><td><code>EURC</code></td><td>6</td><td>Circle&apos;s euro stable</td></tr>
          <tr><td><code>USDT</code></td><td>6</td><td>Highest demand pre-mainnet</td></tr>
          <tr><td><code>USDe</code></td><td>18</td><td>Ethena synthetic dollar (yield-bearing)</td></tr>
          <tr><td><code>DAI</code></td><td>18</td><td>First 18-decimal stable in our app&apos;s regression matrix</td></tr>
          <tr><td><code>PYUSD</code></td><td>6</td><td>PayPal stable, low political risk</td></tr>
          <tr><td><code>NATIVE</code></td><td>varies</td><td>Native chain token</td></tr>
        </tbody>
      </table>
      <p>
        You can also pass a contract address directly for any token App Kit has liquidity for — the alias list is just
        the convenience set.
      </p>

      <h2>Tokens we won&apos;t list</h2>
      <ul>
        <li><strong>TRYC, BRLC, MXNC</strong> — not on Arc, not in App Kit&apos;s alias list.</li>
        <li><strong>USYC</strong> — institutional-only, allowlist + $100k floor. Separate institutional track.</li>
      </ul>

      <h2>Adding a new stable</h2>
      <ol>
        <li>Owner calls <code>setTokenSupport(token, true)</code> on the gateway.</li>
        <li>Relayer&apos;s <code>tokenSymbol(addr)</code> map gets the new entry.</li>
        <li>App config + SDK enum get updated.</li>
        <li>Smoke against the App Kit pair both directions.</li>
      </ol>
      <p>No contract redeploy. Per-stable rollout per Plan 3.</p>
    </DocsShell>
  );
}
