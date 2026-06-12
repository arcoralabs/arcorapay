// Audit 2026-06-11 H-2: official webhook verification helper.
//
// SERVER-SIDE ONLY (uses node:crypto) — which is why this module is shipped
// as the `@arcora/sdk/webhook` subpath instead of being re-exported from the
// root index: the root bundle is also consumed in browsers (CDN/IIFE build,
// publishable-key checkout flows), where importing node:crypto would break
// bundlers without node polyfills.
//
// Signature format mirrors the daemon's signV2 (ops/webhooks/run.ts):
//   X-Arcora-Signature-V2: "sha256=" + HMAC-SHA256_hex(secret, `${ts}.${body}`)
//   X-Arcora-Timestamp:    unix seconds, ASCII
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyWebhookParams {
  /** Raw request body, exactly as received (do not re-stringify parsed JSON). */
  body: string;
  /** Value of the X-Arcora-Signature-V2 header (`sha256=<hex>`). */
  signature: string;
  /** Value of the X-Arcora-Timestamp header (unix seconds). */
  timestamp: string;
  /** Your webhook secret from the dashboard. */
  secret: string;
  /** Replay tolerance in seconds. Default 300. */
  toleranceSeconds?: number;
}

/**
 * Timing-safe verification of Arcora V2 webhook signatures
 * (HMAC-SHA256 over `<timestamp>.<body>`), with a replay window.
 * Server-side only (uses node:crypto).
 */
export function verifyWebhook(p: VerifyWebhookParams): boolean {
  const tolerance = p.toleranceSeconds ?? 300;
  const ts = Number(p.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return false;

  const expected = "sha256=" + createHmac("sha256", p.secret).update(`${p.timestamp}.${p.body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(p.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
