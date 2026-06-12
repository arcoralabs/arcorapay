"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Copy, Share2, ExternalLink, Check } from "lucide-react";
import { toast } from "sonner";

interface Created { invoiceId: string; url: string; }

export function CreateInvoiceDialog({ apiKey, onCreated, fullWidth }: { apiKey: string | null; onCreated: () => void; fullWidth?: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("49.99");
  const [payIn, setPayIn] = useState<"USDC" | "EURC">("EURC");
  const [successUrl, setSuccessUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  // Local apiKey override: bootstrap returns the key once in the response
  // body and we don't store it on session (audit L9). After page reload the
  // dashboard prop is null. Allow the merchant to paste the key they saved
  // in their password manager. Persisted to localStorage so they don't have
  // to paste on every dialog open.
  const [pastedKey, setPastedKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("arcora.apiKey") ?? "";
  });
  const effectiveKey = apiKey ?? pastedKey ?? null;

  // Limits invoice amount to a sane ceiling so a typo (e.g. an extra zero or
  // a paste of a hex address) doesn't mint a multi-million-unit invoice on
  // testnet. 100k USD-equivalent comfortably covers any legitimate use here.
  const AMOUNT_MIN = 0.01;
  const AMOUNT_MAX = 100_000;

  function parseAmount(raw: string): { value: number; error: string | null } {
    const trimmed = raw.trim();
    if (!trimmed) return { value: NaN, error: "Enter an amount" };
    const v = Number(trimmed);
    if (!Number.isFinite(v))    return { value: v, error: "Amount must be a number" };
    if (v < AMOUNT_MIN)         return { value: v, error: `Minimum ${AMOUNT_MIN}` };
    if (v > AMOUNT_MAX)         return { value: v, error: `Maximum ${AMOUNT_MAX.toLocaleString()}` };
    return { value: v, error: null };
  }
  const parsedAmount = parseAmount(amount);
  const amountLabel = payIn === "EURC" ? "Amount (EUR-equivalent)" : "Amount (USD-equivalent)";

  async function handleSubmit() {
    if (parsedAmount.error) { toast.error(parsedAmount.error); return; }
    if (!effectiveKey) { toast.error("Paste your API key (saved at bootstrap) below"); return; }
    if (typeof window !== "undefined") window.localStorage.setItem("arcora.apiKey", effectiveKey);
    setBusy(true);
    try {
      // /api/invoices routes to the active custody-escrow gateway. The legacy
      // ?engine= param from the pre-cutover dual-write window is gone.
      const body: Record<string, unknown> = { amountUsdc: parsedAmount.value, payInToken: payIn };
      // Standalone invoice: omit successUrl when blank so /api/invoices skips
      // the allowlist + SSRF checks. The /i/<id> page will show the paid
      // status without redirecting anywhere.
      if (successUrl.trim()) body.successUrl = successUrl.trim();
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Arcora-Api-Key": effectiveKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "create failed");
      }
      const data = await res.json() as Created;
      setCreated(data);
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Insecure context or permission denied — surface the URL so the
      // merchant can still grab it manually instead of silently failing.
      toast.error("Couldn't copy automatically — select the link to copy manually");
    }
  }

  async function shareLink() {
    if (!created) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "Pay invoice",
          text: `Pay $${amount} on Arcora`,
          url: created.url,
        });
      } catch { /* user cancelled — no-op */ }
    } else {
      await copyLink();
    }
  }

  function reset() {
    setCreated(null);
    setCopied(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={fullWidth ? "pill pill--acc w-full" : "pill pill--acc pill--sm"}
      >
        <Plus className="size-4" /> Create invoice
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "Invoice created" : "Create invoice"}</DialogTitle>
        </DialogHeader>
        {created ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Send this link to your customer — anyone with the URL can pay.
            </p>
            <div className="space-y-2">
              <Label className="eyebrow">Checkout link</Label>
              <code className="field mono block p-3 text-xs break-all">
                {created.url}
              </code>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={copyLink} variant="outline" className="w-full">
                {copied ? <><Check className="size-4 mr-2" />Copied</> : <><Copy className="size-4 mr-2" />Copy link</>}
              </Button>
              <Button onClick={shareLink} variant="outline" className="w-full">
                <Share2 className="size-4 mr-2" />Share
              </Button>
            </div>
            <a
              href={created.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--action)] hover:underline"
            >
              <ExternalLink className="size-3.5" /> Open checkout in new tab
            </a>
            <div className="flex gap-2 pt-2">
              <Button onClick={reset} variant="ghost" className="flex-1">Create another</Button>
              <Button onClick={() => handleOpenChange(false)} className="flex-1">Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-amount">{amountLabel}</Label>
              <Input
                id="invoice-amount"
                type="number"
                step="0.01"
                min={AMOUNT_MIN}
                max={AMOUNT_MAX}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={parsedAmount.error ? true : undefined}
              />
              {parsedAmount.error && amount.trim() !== "" && (
                <p className="text-xs text-[var(--danger)]">{parsedAmount.error}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-payin">Customer pays in</Label>
              <select
                id="invoice-payin"
                value={payIn}
                onChange={(e) => setPayIn(e.target.value as "USDC" | "EURC")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="EURC">EURC</option>
                <option value="USDC">USDC</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-success">Success URL <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="invoice-success"
                placeholder="https://yoursite.com/order/123/success"
                value={successUrl}
                onChange={(e) => setSuccessUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for a standalone payment link — the customer sees a &quot;Payment received&quot; screen instead of being redirected.
                Otherwise the URL must be in your <span className="font-medium">allowed origins</span> (Settings).
              </p>
            </div>
            {!apiKey && (
              <div className="space-y-2">
                <Label htmlFor="invoice-apikey">API key</Label>
                <Input
                  id="invoice-apikey"
                  type="password"
                  autoComplete="off"
                  placeholder="ak_live_…"
                  value={pastedKey}
                  onChange={(e) => setPastedKey(e.target.value.trim())}
                />
                <p className="text-xs text-muted-foreground">
                  The key shown once at bootstrap. Stored in this browser only (localStorage); rotate from{" "}
                  <span className="font-medium">Settings</span> if compromised.
                </p>
              </div>
            )}
            <Button disabled={busy || !!parsedAmount.error} onClick={handleSubmit} className="w-full mt-2">
              {busy ? "Creating…" : "Create invoice"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
