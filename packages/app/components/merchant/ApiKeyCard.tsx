"use client";

import { useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Parses textarea content (one origin per line) into validated URL strings.
 *  Allows http only when host is localhost / 127.0.0.1 (dev convenience). */
function parseOriginLines(raw: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const line of raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    try {
      const u = new URL(line);
      const isLocalhost = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
      if (u.protocol === "https:" || (u.protocol === "http:" && isLocalhost)) {
        ok.push(line);
      } else {
        bad.push(line);
      }
    } catch {
      bad.push(line);
    }
  }
  return { ok, bad };
}

export function ApiKeyCard({ hasMerchant, publishableKey, onBootstrap }: { hasMerchant: boolean; publishableKey?: string; onBootstrap: () => Promise<void> }) {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [originsRaw, setOriginsRaw] = useState("");
  // MED-6: after a rotate, show the fresh key instead of the (stale) prop.
  const [rotatedPk, setRotatedPk] = useState<string | null>(null);
  const [pkBusy, setPkBusy] = useState(false);
  const pk = rotatedPk ?? publishableKey;

  async function copyPublishable() {
    if (pk) {
      await navigator.clipboard.writeText(pk);
      toast.success("Publishable key copied");
    }
  }

  async function rotatePublishable() {
    setPkBusy(true);
    try {
      const res = await fetch("/api/merchant/publishable-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setRotatedPk(data.publishableKey);
      toast.success("Publishable key rotated");
    } catch (e: any) { toast.error(e.message); }
    finally { setPkBusy(false); }
  }

  const parsed = useMemo(() => parseOriginLines(originsRaw), [originsRaw]);
  const canBootstrap = hasMerchant || parsed.ok.length >= 1;

  async function generate() {
    setBusy(true);
    try {
      const endpoint = hasMerchant ? "/api/merchant/api-key" : "/api/merchant/bootstrap";
      const body = hasMerchant ? undefined : JSON.stringify({
        payoutToken: process.env.NEXT_PUBLIC_USDC_ADDRESS,
        allowedOrigins: parsed.ok,
      });
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setRevealedKey(data.apiKey);
      if (!hasMerchant) await onBootstrap();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (revealedKey) {
      await navigator.clipboard.writeText(revealedKey);
      toast.success("API key copied");
    }
  }

  return (
    <section className="card p-[22px]">
      <h3 className="text-base font-semibold m-0">API keys</h3>
      <p className="lead text-[13px] mt-1 mb-4">
        Use your publishable key in the browser SDK and your secret key on the server.
      </p>
      <div className="space-y-4">
        {pk && (
          <div className="space-y-2 pb-4 border-b border-[var(--border)]">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Publishable key</span>
              <span className="tagchip tagchip--ok">Browser-safe</span>
            </div>
            <div className="field flex items-center gap-2.5 px-3 py-2.5">
              <code className="mono text-xs flex-1 break-all text-[var(--fg-2)]">{pk}</code>
              <button
                type="button"
                onClick={copyPublishable}
                className="iconbtn"
                style={{ width: 32, height: 32 }}
                aria-label="Copy publishable key"
                title="Copy publishable key"
              >
                <Copy className="size-[15px]" />
              </button>
            </div>
            <p className="text-xs text-[var(--fg-3)]">
              Safe to embed in client-side code (storefront, SDK <code className="mono">&lt;CheckoutButton&gt;</code>, CDN script). Checkouts are accepted from your allowed origins.
            </p>
            <p className="text-sm text-[var(--fg-2)]">
              Rotate your publishable key. The previous key will stop working immediately.
            </p>
            <button type="button" onClick={rotatePublishable} disabled={pkBusy} className="pill pill--ghost pill--sm">
              <RefreshCw className="size-3.5" />Rotate publishable key
            </button>
          </div>
        )}
        <div className="eyebrow">Secret key</div>
        <p className="rounded-[var(--radius-field)] border border-[color-mix(in_oklch,var(--warning)_35%,transparent)] bg-[var(--warning-bg)] p-2.5 text-xs text-[var(--fg-1)]">
          <strong>Server-side only.</strong> Never put your secret key in browser code — anyone could read it and create invoices or access your data. Use the publishable key above in client code.
        </p>
        {revealedKey ? (
          <>
            <div className="field flex items-center gap-2.5 px-3 py-2.5">
              <code className="mono text-xs flex-1 break-all text-[var(--fg-2)]">{revealedKey}</code>
              <button
                type="button"
                onClick={copy}
                className="iconbtn"
                style={{ width: 32, height: 32 }}
                aria-label="Copy API key"
                title="Copy API key"
              >
                <Copy className="size-[15px]" />
              </button>
            </div>
            <p className="text-sm text-[var(--fg-2)]">
              Save this now — you won&apos;t be able to see it again. Use the rotate button to generate a new one.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setRevealedKey(null)} className="pill pill--ghost pill--sm">Done</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--fg-2)]">
              {hasMerchant ? "Rotate your API key. The previous key will stop working immediately." : "Generate your first API key to start creating invoices programmatically."}
            </p>
            {!hasMerchant && (
              <div className="space-y-2">
                <label htmlFor="allowed-origins" className="eyebrow">Allowed origins (one per line)</label>
                <textarea
                  id="allowed-origins"
                  value={originsRaw}
                  onChange={(e) => setOriginsRaw(e.target.value)}
                  placeholder={"https://your-shop.com\nhttps://staging.your-shop.com"}
                  rows={3}
                  className="field mono w-full px-3 py-2 text-[12.5px] text-[var(--fg-1)] outline-none focus:border-[var(--focus-ring)]"
                />
                <p className="text-xs text-[var(--fg-3)]">
                  URLs in this list can receive your customers after payment success. We accept https everywhere; http is allowed only for localhost during development.
                </p>
                {parsed.bad.length > 0 && (
                  <p className="text-xs text-[var(--danger)]">
                    Skipped {parsed.bad.length} invalid line{parsed.bad.length === 1 ? "" : "s"} (use a full https URL).
                  </p>
                )}
              </div>
            )}
            <button type="button" onClick={generate} disabled={busy || !canBootstrap} className="pill pill--acc pill--sm">
              {hasMerchant ? <><RefreshCw className="size-3.5" />Rotate key</> : "Generate API key"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
