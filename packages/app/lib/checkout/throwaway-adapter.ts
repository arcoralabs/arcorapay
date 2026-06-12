import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { generatePrivateKey } from "viem/accounts";

/**
 * App Kit's `estimateSwap` requires a viem adapter just to pin a chain
 * context — it never broadcasts a tx, never asks the adapter for a
 * signature. We satisfy the shape with an in-process throwaway key that
 * MUST stay unfunded.
 *
 * Audit App-L2 (2026-05-24): /api/checkout/quote and lib/checkout/quote-
 * server.ts both used to maintain their own `cachedAdapter` singleton.
 * Two singletons across the warm Lambda instance meant two keys in
 * memory at once and two surfaces a future refactor could accidentally
 * route a real swap through. This module is now the single source of
 * truth for both callers.
 *
 * ⚠️ INVARIANT — DO NOT REMOVE THIS COMMENT:
 *
 *   This private key is for App Kit chain-context binding ONLY. App Kit's
 *   `estimateSwap` does not request a signature. If a future change wires
 *   this adapter into the actual swap-execution path (kit.swap), the next
 *   attacker who can dump warm-instance memory drains whatever balance
 *   the address holds. Pair every use site with a comment confirming the
 *   call is estimate-only. Audit #29.
 */
let cachedAdapter: ReturnType<typeof createViemAdapterFromPrivateKey> | null = null;

export function getThrowawayAdapter() {
  if (!cachedAdapter) {
    cachedAdapter = createViemAdapterFromPrivateKey({ privateKey: generatePrivateKey() });
  }
  return cachedAdapter;
}

/** Test-only: drop the cached adapter so a fresh key gets minted on the
 *  next call. Production code must never invoke this — re-keying would
 *  break the warm-instance assumption that App Kit relies on for quote
 *  consistency across a single user session. */
export function __resetThrowawayAdapterForTests(): void {
  cachedAdapter = null;
}
