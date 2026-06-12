import { describe, it, expect, vi, beforeEach } from "vitest";
import { EllipticProvider } from "./elliptic";

function fetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;
}

function fetchFail(status = 503): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: "down" }),
    text: async () => "down",
  }) as any;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("EllipticProvider", () => {
  it("identifies as elliptic", () => {
    const p = new EllipticProvider({ apiKey: "k", fetch: fetchOk({ score: 0, sanctioned: false }) });
    expect(p.name).toBe("elliptic");
  });

  it("throws on construction without an api key", () => {
    expect(() => new EllipticProvider({ apiKey: "" })).toThrow(/config_required/i);
  });

  it("maps low scores to risk=low", async () => {
    const p = new EllipticProvider({ apiKey: "k", fetch: fetchOk({ score: 2, sanctioned: false }) });
    const r = await p.screenAddress("0xabc", { flow: "customer_pay" });
    expect(r.risk).toBe("low");
    expect(r.providerScore).toBe(2);
  });

  it("maps mid-range scores to risk=medium", async () => {
    const p = new EllipticProvider({ apiKey: "k", fetch: fetchOk({ score: 5, sanctioned: false, reasons: ["mixer_exposure"] }) });
    const r = await p.screenAddress("0xabc", { flow: "customer_pay" });
    expect(r.risk).toBe("medium");
    expect(r.reasons).toContain("mixer_exposure");
  });

  it("maps high scores to risk=high", async () => {
    const p = new EllipticProvider({ apiKey: "k", fetch: fetchOk({ score: 8, sanctioned: false }) });
    const r = await p.screenAddress("0xabc", { flow: "customer_pay" });
    expect(r.risk).toBe("high");
  });

  it("flags sanctions match regardless of score", async () => {
    const p = new EllipticProvider({ apiKey: "k", fetch: fetchOk({ score: 0, sanctioned: true, sanctionLists: ["OFAC"] }) });
    const r = await p.screenAddress("0xabc", { flow: "customer_pay" });
    expect(r.risk).toBe("sanctions");
    expect(r.reasons.some((s) => s.includes("OFAC"))).toBe(true);
  });

  it("sends OFAC + EU as the active sanction list set", async () => {
    const fetchMock = fetchOk({ score: 0, sanctioned: false });
    const p = new EllipticProvider({ apiKey: "k", fetch: fetchMock });
    await p.screenAddress("0xabc", { flow: "customer_pay" });
    const [, init] = (fetchMock as any).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.sanctionLists).toEqual(expect.arrayContaining(["OFAC", "EU"]));
  });

  it("throws on provider 5xx (caller decides fail-open vs fail-closed)", async () => {
    const p = new EllipticProvider({ apiKey: "k", fetch: fetchFail(503) });
    await expect(p.screenAddress("0xabc", { flow: "customer_pay" })).rejects.toThrow(/provider/i);
  });

  // Audit M5 — configurable asset
  it("sends the configured asset identifier in the request body", async () => {
    const fetchMock = fetchOk({ score: 0, sanctioned: false });
    const p = new EllipticProvider({ apiKey: "k", asset: "arc", fetch: fetchMock });
    await p.screenAddress("0xdef", { flow: "customer_pay" });
    const [, init] = (fetchMock as any).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.subject.asset).toBe("arc");
  });

  it("defaults to ETH when no asset is configured (back-compat)", async () => {
    const fetchMock = fetchOk({ score: 0, sanctioned: false });
    const p = new EllipticProvider({ apiKey: "k", fetch: fetchMock });
    await p.screenAddress("0xdef", { flow: "customer_pay" });
    const [, init] = (fetchMock as any).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.subject.asset).toBe("ETH");
  });
});
