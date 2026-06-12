"use client";

import { useState } from "react";
import { toast } from "sonner";

export function WebhookSettingsCard({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Audit #32: server already rejects non-https + SSRF, but a client-side
  // scheme check turns the silent 400 into an inline error before the
  // PATCH fires. Empty string is allowed (= clear the webhook).
  function urlError(): string | null {
    const trimmed = url.trim();
    if (trimmed === "") return null;
    try {
      const u = new URL(trimmed);
      if (u.protocol !== "https:") return "URL must start with https://";
      return null;
    } catch {
      return "Not a valid URL";
    }
  }
  const urlErr = urlError();

  async function save() {
    if (urlErr) { toast.error(urlErr); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/webhook", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhookUrl: url.trim() || null }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success("Webhook URL saved");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function rotateSecret() {
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/webhook", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "rotate failed");
      setRevealedSecret(data.webhookSecret);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="card p-[22px]">
      <h3 className="text-base font-semibold m-0">Webhook endpoint</h3>
      <p className="lead text-[13px] mt-1 mb-4">
        We POST signed <code className="mono text-xs">invoice.paid</code> / <code className="mono text-xs">invoice.refunded</code> events here.
      </p>
      <div className="space-y-4">
        <div>
          <label htmlFor="webhook-url" className="eyebrow mb-2 block">URL</label>
          <input
            id="webhook-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.com/webhooks/arcora"
            aria-invalid={urlErr ? true : undefined}
            className="field mono w-full px-3 py-2.5 text-[12.5px] text-[var(--fg-1)] outline-none focus:border-[var(--focus-ring)]"
          />
          {urlErr && <p className="mt-1 text-xs text-[var(--danger)]">{urlErr}</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={busy || !!urlErr} className="pill pill--acc pill--sm">Save</button>
          <button type="button" onClick={rotateSecret} disabled={busy} className="pill pill--ghost pill--sm">Rotate signing secret</button>
        </div>
        {revealedSecret && (
          <div className="space-y-2">
            <code className="field mono block p-3 text-xs break-all text-[var(--fg-2)]">{revealedSecret}</code>
            <p className="text-xs text-[var(--fg-3)]">
              Verify webhooks: <code className="mono">X-Arcora-Signature</code> = sha256=hex(HMAC-SHA256(body, secret)).
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
