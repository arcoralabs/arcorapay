"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

/** Mirrors the parser in ApiKeyCard — accepts https everywhere, http only
 *  for localhost (dev convenience). Each line is an independent URL. */
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

export function AllowedOriginsCard({ initialOrigins }: { initialOrigins: readonly string[] }) {
  const [raw, setRaw] = useState(initialOrigins.join("\n"));
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseOriginLines(raw), [raw]);
  const canSave = parsed.ok.length >= 1;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/origins", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowedOrigins: parsed.ok }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      toast.success(`Saved ${data.allowedOrigins.length} origin${data.allowedOrigins.length === 1 ? "" : "s"}`);
      // Replace input with the server-normalized list (path/query stripped).
      setRaw((data.allowedOrigins as string[]).join("\n"));
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="card p-[22px]">
      <h3 className="text-base font-semibold m-0">Allowed redirect origins</h3>
      <p className="lead text-[13px] mt-1 mb-4">
        URLs in this list can receive your customers after payment success or cancellation.
        We accept <code className="mono text-xs">https://</code> URLs everywhere; <code className="mono text-xs">http://localhost</code> is allowed for development.
      </p>
      <div className="space-y-4">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"https://your-shop.com\nhttps://staging.your-shop.com"}
          rows={4}
          aria-label="Allowed redirect origins"
          className="field mono w-full px-3 py-2 text-[12.5px] text-[var(--fg-1)] outline-none focus:border-[var(--focus-ring)]"
        />
        {parsed.bad.length > 0 && (
          <p className="text-xs text-[var(--danger)]">
            Skipped {parsed.bad.length} invalid line{parsed.bad.length === 1 ? "" : "s"} (use a full https URL).
          </p>
        )}
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={busy || !canSave} className="pill pill--acc pill--sm">Save</button>
          <span className="mono text-xs text-[var(--fg-3)]">{parsed.ok.length} valid origin{parsed.ok.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </section>
  );
}
