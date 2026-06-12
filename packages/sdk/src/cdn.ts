/**
 * Flat exports for the IIFE bundle, so a `<script>` tag user can write
 *   Arcora.init({ apiKey })
 *   Arcora.createInvoice({ … })
 *   Arcora.openCheckout(inv)
 * instead of the nested `window.Arcora.Arcora.init(…)` they'd get if we
 * IIFE'd the module shape directly.
 *
 * These re-exports are the singleton facade. In any environment that can
 * `import`, prefer `new Arcora({ apiKey })` — the singleton leaks state
 * across tenants and is scheduled for removal in the next major.
 */
import { Arcora } from "./client";

/** @deprecated Use `new Arcora({ apiKey })`. CDN bundle only — slated for removal in the next major. */
export const init          = Arcora.init;
/** @deprecated Use `new Arcora(opts).createInvoice(params)`. CDN bundle only. */
export const createInvoice = Arcora.createInvoice;
/** @deprecated Use `new Arcora(opts).openCheckout(invoice)`. CDN bundle only. */
export const openCheckout  = Arcora.openCheckout;

export { ArcoraError, type ArcoraErrorCode } from "./error";
export type * from "./types";
