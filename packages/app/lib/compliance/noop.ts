import type { ComplianceProvider } from "./provider";
import type { ScreeningContext, ScreeningResult } from "./types";

/**
 * Always returns `risk: "low"`. The default provider on testnet, in tests,
 * and any environment where `COMPLIANCE_PROVIDER` is unset. Mainnet Phase 0
 * runs this everywhere too — phase flips swap it for a real adapter via env.
 */
export class NoopProvider implements ComplianceProvider {
  readonly name = "noop" as const;

  async screenAddress(
    address: string,
    context: ScreeningContext,
  ): Promise<ScreeningResult> {
    return {
      risk: "low",
      reasons: [],
      providerSnapshot: { provider: "noop", address, context },
      cachedAt: new Date(),
      ttlSeconds: 24 * 3600,
    };
  }
}
