import { describe, it, expect } from "vitest";
import { NoopProvider } from "./noop";

describe("NoopProvider", () => {
  const provider = new NoopProvider();

  it("identifies as noop", () => {
    expect(provider.name).toBe("noop");
  });

  it("returns risk=low for any address regardless of flow", async () => {
    const result = await provider.screenAddress(
      "0x0000000000000000000000000000000000000001",
      { flow: "customer_pay", invoiceId: "0xdead" },
    );
    expect(result.risk).toBe("low");
    expect(result.reasons).toEqual([]);
    expect(result.providerSnapshot).toBeDefined();
    expect(result.ttlSeconds).toBeGreaterThan(0);
    expect(result.cachedAt).toBeInstanceOf(Date);
  });

  it("works for merchant_payout flow too", async () => {
    const result = await provider.screenAddress(
      "0xc0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff",
      { flow: "merchant_payout", merchantId: "00000000-0000-0000-0000-000000000001" },
    );
    expect(result.risk).toBe("low");
  });
});
