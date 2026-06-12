import { useMemo, useState } from "react";
import { Arcora, ArcoraError } from "@arcora/sdk";

const API_BASE = (import.meta.env.VITE_ARC_BASE_URL ?? "https://arcorapay.xyz").replace(/\/$/, "");
const API_KEY  = import.meta.env.VITE_ARC_API_KEY ?? "";

// Vite inlines VITE_* vars into the built JS bundle, so any key here is
// public. Only publishable keys (pk_…) are safe to embed: they can only
// create checkouts, and only from origins the merchant allowlisted. Secret
// keys (ak_…, test OR live) are privileged — never ship one in client code.
const KEY_IS_PUBLISHABLE = API_KEY.startsWith("pk_");

export default function App() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SDK ^1.1.0: prefer the instance API (`new Arcora({...})`) over the
  // deprecated module-level singleton (`Arcora.init` + `Arcora.createInvoice`)
  // — singletons leak state across tenants in any host app that mounts more
  // than one merchant. (Audit #24.)
  const arcora = useMemo(
    () => (KEY_IS_PUBLISHABLE ? new Arcora({ apiKey: API_KEY, baseUrl: API_BASE }) : null),
    [],
  );

  const params = new URLSearchParams(window.location.search);
  const paid      = params.get("paid") === "1";
  const cancelled = params.get("cancelled") === "1";

  async function handlePay() {
    if (!arcora) return;
    setBusy(true);
    setError(null);
    try {
      const invoice = await arcora.createInvoice({
        amountUsdc: 4.50,
        payInToken: "EURC",
        successUrl: window.location.origin + "/?paid=1",
        cancelUrl:  window.location.origin + "/?cancelled=1",
      });
      arcora.openCheckout(invoice);
    } catch (e) {
      setError(e instanceof ArcoraError ? `${e.code}: ${e.message}` : (e as Error).message);
      setBusy(false);
    }
  }

  if (!KEY_IS_PUBLISHABLE) {
    return (
      <main>
        <div className="card">
          <div className="brand">☕ Acme Coffee</div>
          <div className="banner danger">
            <strong>Demo blocked</strong>
            {API_KEY
              ? "Use your publishable key (pk_live_…) in VITE_ARC_API_KEY. Secret keys (ak_…) must never ship in client code — see packages/shop for the server-routed pattern. Note: publishable-key invoice creation also requires this demo's origin to be in your merchant's allowed origins (set at /m/settings)."
              : "VITE_ARC_API_KEY missing. Set your publishable key (pk_live_…) in .env.local — never a secret key (ak_…); see packages/shop for the server-routed pattern."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="card">
        <div className="brand">☕ Acme Coffee</div>
        <div className="banner warn">
          <strong>Publishable-key demo</strong>
          The pk_ key inlined into this bundle is browser-safe: it can only
          create checkouts, and only from origins allowlisted at /m/settings.
        </div>
        <h1>One americano, please.</h1>
        <p>€4.50 · payable in EURC on Arc Network</p>
        <button onClick={handlePay} disabled={busy} className="pay-btn">
          {busy ? "Loading…" : "Pay €4.50"}
        </button>

        {paid && (
          <div className="status success">✓ Payment received — thanks for visiting!</div>
        )}
        {cancelled && (
          <div className="status warn">Payment cancelled. Try again whenever you&apos;re ready.</div>
        )}
        {error && (
          <div className="status error">
            <strong>Couldn&apos;t start checkout:</strong>
            <code>{error}</code>
          </div>
        )}

        <div className="footer">
          <a href={API_BASE} target="_blank" rel="noopener noreferrer">
            Powered by Arcora →
          </a>
        </div>
      </div>
    </main>
  );
}
