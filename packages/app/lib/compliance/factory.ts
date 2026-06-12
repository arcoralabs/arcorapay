import type { ComplianceProvider } from "./provider";
import { NoopProvider } from "./noop";
import { EllipticProvider } from "./elliptic";
import { TRMLabsProvider } from "./trmlabs";

/**
 * Resolve the active compliance provider from env. Default `noop`. A real
 * provider selection without an API key throws `config_required` at startup
 * so a misconfigured deploy fails fast instead of allowing every screen.
 *
 * Env:
 *   COMPLIANCE_PROVIDER  noop | elliptic | trmlabs   (default: noop)
 *   COMPLIANCE_API_KEY   provider-specific secret    (required for non-noop)
 *   COMPLIANCE_REQUIRED  "true" on mainnet/production (default: false)
 */

/**
 * AFG-005 (2026-06-06): true in a deployment that must enforce screening (set by
 * the mainnet pre-flight). When true, the no-op provider is forbidden and
 * invoice creation fails CLOSED on RPC/provider errors instead of falling
 * through. Default false keeps the testnet noop + fail-open behavior intact.
 */
export function complianceRequired(): boolean {
  return process.env.COMPLIANCE_REQUIRED === "true";
}

export function resolveComplianceProvider(): ComplianceProvider {
  const name = (process.env.COMPLIANCE_PROVIDER ?? "noop").toLowerCase();
  const apiKey = process.env.COMPLIANCE_API_KEY ?? "";

  // AFG-005: noop allows every screen — forbid it when compliance is required so
  // a misconfigured mainnet deploy fails fast instead of running open.
  if (complianceRequired() && name === "noop") {
    throw new Error(
      "compliance_required: COMPLIANCE_REQUIRED=true forbids the noop provider; set COMPLIANCE_PROVIDER to a real adapter (elliptic|trmlabs)",
    );
  }

  switch (name) {
    case "noop":
      return new NoopProvider();
    case "elliptic":
      return new EllipticProvider({ apiKey, asset: process.env.ELLIPTIC_ASSET || undefined });
    case "trmlabs":
      return new TRMLabsProvider({ apiKey });
    default:
      throw new Error(`unknown_provider: ${name}`);
  }
}
