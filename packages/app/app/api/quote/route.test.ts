import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/chain/client", () => ({
  publicClient: { readContract: vi.fn() },
  POOL: "0xpool",
  GATEWAY: "0xgw",
}));

beforeEach(() => { vi.clearAllMocks(); });

function urlFor(qs: string) { return new Request(`http://localhost/api/quote?${qs}`) as any; }

describe("GET /api/quote", () => {
  it("rejects missing params with 400", async () => {
    const res = await GET(urlFor(""));
    expect(res.status).toBe(400);
  });

  it("returns calculateSwap result for EURC→USDC", async () => {
    const m = await import("@/lib/chain/client");
    (m.publicClient.readContract as any).mockResolvedValue(108587n);
    const res = await GET(urlFor("from=EURC&to=USDC&amountIn=100000"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.amountOut).toBe("108587");
  });
});
