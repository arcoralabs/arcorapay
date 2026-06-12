import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRMLabsProvider } from "./trmlabs";

function fetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("TRMLabsProvider", () => {
  it("identifies as trmlabs", () => {
    const p = new TRMLabsProvider({ apiKey: "k", fetch: fetchOk({ riskScore: 0, sanctions: [] }) });
    expect(p.name).toBe("trmlabs");
  });

  it("throws on construction without an api key", () => {
    expect(() => new TRMLabsProvider({ apiKey: "" })).toThrow(/config_required/i);
  });

  it("maps TRM riskScore (0-10) into risk enum", async () => {
    const cases: Array<[number, "low" | "medium" | "high"]> = [
      [0, "low"], [3, "low"], [4, "medium"], [6, "medium"], [7, "high"], [9, "high"],
    ];
    for (const [score, expected] of cases) {
      const p = new TRMLabsProvider({ apiKey: "k", fetch: fetchOk({ riskScore: score, sanctions: [] }) });
      const r = await p.screenAddress("0xabc", { flow: "customer_pay" });
      expect(r.risk).toBe(expected);
      expect(r.providerScore).toBe(score);
    }
  });

  it("returns risk=sanctions when TRM returns any sanction match", async () => {
    const p = new TRMLabsProvider({ apiKey: "k", fetch: fetchOk({ riskScore: 1, sanctions: [{ list: "OFAC", entity: "Tornado Cash" }] }) });
    const r = await p.screenAddress("0xabc", { flow: "customer_pay" });
    expect(r.risk).toBe("sanctions");
    expect(r.reasons.some((s) => s.toLowerCase().includes("tornado cash"))).toBe(true);
  });

  it("requests OFAC + EU lists", async () => {
    const fetchMock = fetchOk({ riskScore: 0, sanctions: [] });
    const p = new TRMLabsProvider({ apiKey: "k", fetch: fetchMock });
    await p.screenAddress("0xabc", { flow: "customer_pay" });
    const [, init] = (fetchMock as any).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.sanctionLists).toEqual(expect.arrayContaining(["OFAC", "EU"]));
  });
});
