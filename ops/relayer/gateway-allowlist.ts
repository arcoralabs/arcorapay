// AFG-010 (2026-06-06): the gateway address a queue row settles against is used
// as BOTH the ERC-20 approve spender AND the settleInvoice target. It comes from
// the `invoices.gateway_address` DB column, so a tampered value (e.g. a DB MITM
// behind a weak TLS config — see AFG-011) could redirect the approval/settle to
// an attacker contract. Constrain it to an allowlist so the relayer never trusts
// a mutable DB value blindly.
import type { Address } from "viem";

/** Allowlist = the daemon's own GATEWAY_ADDRESS ∪ optional GATEWAY_ALLOWLIST
 *  (comma-separated; for in-flight gateway migrations). All lowercased. */
export function buildGatewayAllowlist(gatewayAddress: string, allowlistEnv?: string): Set<string> {
  const set = new Set<string>([gatewayAddress.toLowerCase()]);
  for (const a of (allowlistEnv ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)) {
    set.add(a);
  }
  return set;
}

/** Resolve the row's gateway (falling back to the daemon default for legacy
 *  rows), then assert it's allowlisted. Throws `gateway_not_allowlisted:<addr>`
 *  otherwise so the row fails the job instead of approving an unknown spender. */
export function resolveGateway(
  rowGateway: string | null,
  fallback: string,
  allowlist: ReadonlySet<string>,
): Address {
  const addr = (rowGateway ?? fallback).toLowerCase();
  if (!allowlist.has(addr)) {
    throw new Error(`gateway_not_allowlisted:${addr}`);
  }
  return addr as Address;
}
