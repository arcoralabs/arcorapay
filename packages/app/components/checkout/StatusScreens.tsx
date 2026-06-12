"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { safeClientRedirect } from "@/lib/security/redirect";

const screenHeadingCls = "disp text-[30px] font-medium";

/** Returns true when `url` is safe to render as a clickable link from this
 *  page — same rules as `safeClientRedirect` minus the `window.location` write. */
function isOriginAllowed(url: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return allowedOrigins.includes(u.origin);
  } catch {
    return false;
  }
}

export function SuccessScreen({ successUrl, allowedOrigins }: { successUrl: string; allowedOrigins: readonly string[] }) {
  const isStandalone = !successUrl;  // standalone invoice — no redirect target was supplied
  const safe = useMemo(
    () => (isStandalone ? false : isOriginAllowed(successUrl, allowedOrigins)),
    [isStandalone, successUrl, allowedOrigins],
  );
  const [seconds, setSeconds] = useState(3);

  useEffect(() => {
    if (!safe) return;
    // Clamp at 0 so the countdown can't flash a "-1s" tick between the final
    // setInterval and the redirect setTimeout firing.
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    const r = setTimeout(() => { safeClientRedirect(successUrl, allowedOrigins); }, 3000);
    return () => { clearInterval(t); clearTimeout(r); };
  }, [safe, successUrl, allowedOrigins]);

  if (isStandalone) {
    // Standalone invoice: merchant created a payment link with no redirect
    // target. Show a clean confirmation; no "merchant" attribution.
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <SuccessGlyph />
        <div>
          <span className="tagchip tagchip--ok mb-3">Paid</span>
          <h2 className={screenHeadingCls}>
            Payment received
          </h2>
          <p className="mt-2 text-[14px] text-[var(--fg-2)]">Thanks — you can close this tab.</p>
        </div>
      </div>
    );
  }

  if (!safe) {
    // Audit H1 (2026-05-05): server should never persist an out-of-allowlist
    // URL, but if a stale invoice or DOM tamper produces one we render a
    // static "payment received" screen rather than auto-redirecting to an
    // attacker-controlled page.
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <SuccessGlyph />
        <div>
          <span className="tagchip tagchip--ok mb-3">Paid</span>
          <h2 className={screenHeadingCls}>
            Payment received
          </h2>
          <p className="mt-2 text-[14px] text-[var(--fg-2)] max-w-sm mx-auto">
            We can&apos;t safely return you to the merchant — the redirect target isn&apos;t in their allowlist. Close this tab or contact the merchant directly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <SuccessGlyph />
      <div>
        <span className="tagchip tagchip--ok mb-3">Paid</span>
        <h2 className={screenHeadingCls}>
          Payment received
        </h2>
        <p className="mt-2 text-[14px] text-[var(--fg-2)]">Redirecting to merchant in {seconds}s…</p>
      </div>
    </div>
  );
}

/** Shared success roundel — semantic success tokens in both themes. */
function SuccessGlyph() {
  return (
    <div
      className="size-16 rounded-full grid place-items-center bg-[var(--success-bg)] border"
      style={{ borderColor: "color-mix(in oklch, var(--success) 30%, transparent)" }}
    >
      <Check className="size-8 text-[var(--success)]" />
    </div>
  );
}

/** Non-success terminal states share this screen; the copy must not claim
 *  "expired" for invoices that failed or were refunded (review 2026-06-10). */
export type TerminalVariant = "expired" | "failed" | "refunded";

const TERMINAL_COPY: Record<TerminalVariant, { chip: string; heading: string; body: string }> = {
  expired: {
    chip: "Expired",
    heading: "Invoice expired",
    body: "Please request a new invoice from the merchant.",
  },
  failed: {
    chip: "Failed",
    heading: "Payment failed",
    body: "The payment could not be completed. If funds were taken, they have been returned.",
  },
  refunded: {
    chip: "Refunded",
    heading: "Invoice refunded",
    body: "The payment was returned to the payer.",
  },
};

export function ExpiredScreen({ variant = "expired", cancelUrl, allowedOrigins }: {
  variant?: TerminalVariant;
  cancelUrl?: string;
  allowedOrigins: readonly string[];
}) {
  const copy = TERMINAL_COPY[variant];
  // Audit H1 (2026-05-05): the return link stays allowlist-gated for every
  // variant — same isOriginAllowed check, no weakening.
  const safe = isOriginAllowed(cancelUrl, allowedOrigins);
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <div className="size-16 rounded-full bg-[var(--surface-3)] border border-[var(--border)] grid place-items-center">
        <span className="mono text-[20px] text-[var(--fg-3)]">×</span>
      </div>
      <div>
        <span className="tagchip tagchip--mut mb-3">{copy.chip}</span>
        <h2 className={screenHeadingCls}>
          {copy.heading}
        </h2>
        <p className="mt-2 text-[14px] text-[var(--fg-2)]">{copy.body}</p>
      </div>
      {safe && cancelUrl && (
        <a href={cancelUrl} className="pill pill--ghost mt-2">Return to merchant</a>
      )}
    </div>
  );
}

export function NotFoundScreen() {
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <div>
        <h2 className={screenHeadingCls}>
          Invoice not found
        </h2>
        <p className="mt-2 text-[14px] text-[var(--fg-2)]">This invoice doesn&apos;t exist or has been removed.</p>
      </div>
    </div>
  );
}
