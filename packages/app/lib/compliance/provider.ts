import type { ProviderName, ScreeningContext, ScreeningResult } from "./types";

export interface ComplianceProvider {
  readonly name: ProviderName;
  screenAddress(address: string, context: ScreeningContext): Promise<ScreeningResult>;
}
