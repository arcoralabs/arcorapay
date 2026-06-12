"use client";

import { useCallback, useEffect, useState } from "react";

export type GateStatus = "idle" | "checking" | "allow" | "review" | "reject" | "error";

export interface GateState {
  status: GateStatus;
  ticketId?: string;
  reason?: string;
  code?: string;
}

export interface GateHandle extends GateState {
  /** Re-runs the authorize call. Use after an `error` status to retry on
   *  transient RPC / endpoint failures without forcing a full page reload. */
  refresh: () => void;
}

/**
 * Calls `/api/checkout/authorize` after wallet connect, before the customer
 * signs the Permit2 message. The PayButton is gated on `status === "allow"`.
 */
export function useComplianceGate(invoiceId: string, address: string | undefined): GateHandle {
  const [state, setState] = useState<GateState>({ status: "idle" });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!address) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "checking" });
    fetch("/api/checkout/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId, address }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (body?.decision === "allow") {
          // Audit residual P2 (2026-05-05): a `decision: allow` response
          // without minAmountIn means the server couldn't persist a
          // checkout_authorizations row (or returned a malformed allow).
          // Submit would reject with authorization_required, so don't let
          // the customer start the Permit2 sign flow.
          if (typeof body.minAmountIn !== "string") {
            setState({ status: "error", reason: "authorization_not_persisted" });
            return;
          }
          setState({ status: "allow" });
        } else if (body?.decision === "review") {
          setState({ status: "review", ticketId: body.ticketId, reason: body.reason });
        } else if (body?.decision === "reject") {
          setState({ status: "reject", code: body.code, reason: body.reason });
        } else {
          // No decision in body (e.g. invoice_not_found) — surface as error.
          setState({ status: "error", reason: body?.error ?? `unexpected_status_${res.status}` });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", reason: String(err?.message ?? err) });
      });
    return () => { cancelled = true; };
  }, [invoiceId, address, tick]);

  return { ...state, refresh };
}
