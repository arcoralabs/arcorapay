import { describe, it, expect, vi, beforeEach } from "vitest";

const SUBMISSION_ID = "11111111-2222-3333-4444-555555555555";
let queueRows: unknown[] = [];
let invoiceRows: unknown[] = [];
let selectCallCount = 0;

vi.mock("@/lib/db/client", () => {
  const builder = {
    select: vi.fn(),
    from:   vi.fn(),
    where:  vi.fn(),
    limit:  vi.fn(),
  };
  builder.select.mockImplementation(() => builder);
  builder.from.mockImplementation(() => builder);
  builder.where.mockImplementation(() => builder);
  builder.limit.mockImplementation(async () => {
    selectCallCount++;
    // First select = relayer_queue lookup, second = invoices for token check.
    if (selectCallCount === 1) return queueRows;
    return invoiceRows;
  });
  return { db: builder };
});

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ a, b }),
}));

import { GET } from "./route";

const baseRow = {
  status:       "settled" as const,
  invoiceId:    "0x" + "ab".repeat(32),
  attempts:     1,
  swapTxHash:   "0xswap",
  settleTxHash: "0xsettle",
  refundTxHash: null,
  lastError:    null,
  createdAt:    new Date("2026-05-01T10:00:00Z"),
  updatedAt:    new Date("2026-05-01T10:00:05Z"),
};

const VALID_TOKEN = "valid-token-".padEnd(48, "0");
const VALID_INVOICE = {
  statusToken: VALID_TOKEN,
  statusTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
};

beforeEach(() => {
  queueRows = [];
  invoiceRows = [];
  selectCallCount = 0;
});

function call(qs = "", headers: Record<string, string> = {}) {
  // Build a NextRequest-shape stub. We use Request + spy on nextUrl.searchParams.
  const url = `http://localhost/api/checkout/status/${SUBMISSION_ID}${qs}`;
  const req: any = new Request(url, { headers });
  // Simulate Next's NextRequest.nextUrl.
  Object.defineProperty(req, "nextUrl", {
    value: new URL(url),
    configurable: true,
  });
  return GET(req as never, { params: Promise.resolve({ id: SUBMISSION_ID }) });
}

describe("GET /api/checkout/status/[id]", () => {
  it("returns 404 for unknown submission", async () => {
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("WITHOUT token: returns ONLY { status } (M12 minimum)", async () => {
    queueRows = [baseRow];
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("settled");
    // No detail leak — no tx hashes, no error string, no timestamps.
    expect(body.swapTxHash).toBeUndefined();
    expect(body.settleTxHash).toBeUndefined();
    expect(body.error).toBeUndefined();
    expect(body.invoiceId).toBeUndefined();
  });

  it("WITH valid token: returns full detail (settled state, both tx hashes)", async () => {
    queueRows = [baseRow];
    invoiceRows = [VALID_INVOICE];
    const res = await call("", { "x-status-token": VALID_TOKEN });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("settled");
    expect(body.swapTxHash).toBe("0xswap");
    expect(body.settleTxHash).toBe("0xsettle");
    expect(body.error).toBeNull();
  });

  it("WITH valid token via header: surfaces lastError only when status is failed", async () => {
    queueRows = [{ ...baseRow, status: "failed", lastError: "kit.swap timed out" }];
    invoiceRows = [VALID_INVOICE];
    const res = await call("", { "x-status-token": VALID_TOKEN });
    expect((await res.json()).error).toBe("kit.swap timed out");
  });

  it("WITH valid token: hides lastError on transient processing rows", async () => {
    queueRows = [{ ...baseRow, status: "processing", lastError: "transient rpc blip" }];
    invoiceRows = [VALID_INVOICE];
    const res = await call("", { "x-status-token": VALID_TOKEN });
    expect((await res.json()).error).toBeNull();
  });

  it("expired token treated as missing — falls back to bare status", async () => {
    queueRows = [baseRow];
    invoiceRows = [{
      statusToken: VALID_TOKEN,
      statusTokenExpiresAt: new Date(Date.now() - 1000), // already expired
    }];
    const res = await call("", { "x-status-token": VALID_TOKEN });
    const body = await res.json();
    expect(body.status).toBe("settled");
    expect(body.swapTxHash).toBeUndefined();
  });

  it("wrong token rejected — falls back to bare status", async () => {
    queueRows = [baseRow];
    invoiceRows = [VALID_INVOICE];
    const res = await call("", { "x-status-token": "not-the-real-token" });
    const body = await res.json();
    expect(body.status).toBe("settled");
    expect(body.swapTxHash).toBeUndefined();
  });

  it("HIGH-4: a VALID token in the query string is IGNORED — bare status only", async () => {
    queueRows = [baseRow];
    invoiceRows = [VALID_INVOICE];
    const res = await call(`?token=${encodeURIComponent(VALID_TOKEN)}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("settled");
    // Detail must NOT unlock via the query channel (CWE-598: tokens in
    // query strings leak into access logs).
    expect(body.swapTxHash).toBeUndefined();
    expect(body.settleTxHash).toBeUndefined();
    expect(body.invoiceId).toBeUndefined();
    expect(body.error).toBeUndefined();
  });

  it("bare-status response is Cache-Control: no-store exactly (public endpoint, not private)", async () => {
    queueRows = [baseRow];
    const res = await call();
    expect(res.status).toBe(200);
    // Exactly `no-store` — NOT `no-store, private`. This endpoint is polled
    // anonymously; `private` would wrongly imply authenticated data.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
