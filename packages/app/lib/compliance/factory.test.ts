import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveComplianceProvider, complianceRequired } from "./factory";
import { NoopProvider } from "./noop";
import { EllipticProvider } from "./elliptic";
import { TRMLabsProvider } from "./trmlabs";

const ENV_KEYS = ["COMPLIANCE_PROVIDER", "COMPLIANCE_API_KEY", "COMPLIANCE_REQUIRED"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveComplianceProvider", () => {
  it("defaults to Noop when env is unset", () => {
    expect(resolveComplianceProvider()).toBeInstanceOf(NoopProvider);
  });

  it("returns Noop when COMPLIANCE_PROVIDER=noop", () => {
    process.env.COMPLIANCE_PROVIDER = "noop";
    expect(resolveComplianceProvider()).toBeInstanceOf(NoopProvider);
  });

  it("returns Elliptic when configured with key", () => {
    process.env.COMPLIANCE_PROVIDER = "elliptic";
    process.env.COMPLIANCE_API_KEY = "k";
    expect(resolveComplianceProvider()).toBeInstanceOf(EllipticProvider);
  });

  it("returns TRM when configured with key", () => {
    process.env.COMPLIANCE_PROVIDER = "trmlabs";
    process.env.COMPLIANCE_API_KEY = "k";
    expect(resolveComplianceProvider()).toBeInstanceOf(TRMLabsProvider);
  });

  it("throws when a real provider is selected without an API key", () => {
    process.env.COMPLIANCE_PROVIDER = "elliptic";
    expect(() => resolveComplianceProvider()).toThrow(/config_required/i);
  });

  it("rejects unknown provider names", () => {
    process.env.COMPLIANCE_PROVIDER = "chainalysis";
    expect(() => resolveComplianceProvider()).toThrow(/unknown_provider/i);
  });
});

// AFG-005 (2026-06-06): in a compliance-required deployment (mainnet pre-flight),
// the noop provider must be forbidden so a misconfig fails closed at startup.
describe("AFG-005 — COMPLIANCE_REQUIRED forbids fail-open config", () => {
  it("complianceRequired() is false by default (testnet), true only when set", () => {
    expect(complianceRequired()).toBe(false);
    process.env.COMPLIANCE_REQUIRED = "true";
    expect(complianceRequired()).toBe(true);
  });

  it("throws when COMPLIANCE_REQUIRED=true and provider defaults to noop", () => {
    process.env.COMPLIANCE_REQUIRED = "true";
    expect(() => resolveComplianceProvider()).toThrow(/compliance_required/i);
  });

  it("throws when COMPLIANCE_REQUIRED=true and provider is explicitly noop", () => {
    process.env.COMPLIANCE_REQUIRED = "true";
    process.env.COMPLIANCE_PROVIDER = "noop";
    expect(() => resolveComplianceProvider()).toThrow(/compliance_required/i);
  });

  it("allows a real provider when COMPLIANCE_REQUIRED=true", () => {
    process.env.COMPLIANCE_REQUIRED = "true";
    process.env.COMPLIANCE_PROVIDER = "trmlabs";
    process.env.COMPLIANCE_API_KEY = "k";
    expect(resolveComplianceProvider()).toBeInstanceOf(TRMLabsProvider);
  });

  it("still defaults to Noop on testnet (COMPLIANCE_REQUIRED unset)", () => {
    expect(resolveComplianceProvider()).toBeInstanceOf(NoopProvider);
  });
});
