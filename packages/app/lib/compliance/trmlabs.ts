import type { ComplianceProvider } from "./provider";
import type { Risk, ScreeningContext, ScreeningResult } from "./types";

/**
 * TRM Labs Forensics API adapter. Same Risk mapping as Elliptic so phase
 * flips between providers are config-only. Sanction lists: OFAC + EU.
 */

const SANCTION_LISTS = ["OFAC", "EU"] as const;

export interface TRMLabsConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface TRMSanction {
  list?: string;
  entity?: string;
}

interface TRMResponse {
  riskScore?: number;
  sanctions?: TRMSanction[];
  reasons?: string[];
}

export class TRMLabsProvider implements ComplianceProvider {
  readonly name = "trmlabs" as const;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: TRMLabsConfig) {
    if (!config.apiKey) {
      throw new Error("config_required: TRMLABS apiKey not set");
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl ?? "https://api.trmlabs.com";
    this.#fetch = config.fetch ?? fetch;
  }

  async screenAddress(
    address: string,
    context: ScreeningContext,
  ): Promise<ScreeningResult> {
    const res = await this.#fetch(`${this.#baseUrl}/public/v2/screening/addresses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        address,
        chain: "arc",
        sanctionLists: SANCTION_LISTS,
        flow: context.flow,
      }),
      // 10 s ceiling so a stalled provider can't hold a serverless slot open
      // for the full function timeout. The /api/checkout/authorize path runs
      // fail-closed and the /api/invoices path runs fail-open by default —
      // either way we want to give up on the upstream long before the
      // platform does.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`provider_error: trmlabs ${res.status}`);
    }

    const body = (await res.json()) as TRMResponse;
    const score = typeof body.riskScore === "number" ? body.riskScore : 0;
    const sanctions = body.sanctions ?? [];
    const reasons: string[] = [];

    for (const s of sanctions) {
      const label = [s.list, s.entity].filter(Boolean).join(": ");
      if (label) reasons.push(label);
    }
    for (const r of body.reasons ?? []) reasons.push(r);

    const risk: Risk = sanctions.length > 0
      ? "sanctions"
      : score >= 7 ? "high"
      : score >= 4 ? "medium"
      : "low";

    return {
      risk,
      reasons,
      providerScore: score,
      providerSnapshot: body,
      cachedAt: new Date(),
      ttlSeconds: 24 * 3600,
    };
  }
}
