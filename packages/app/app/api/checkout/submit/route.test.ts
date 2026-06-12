import { describe, it, expect, vi, beforeEach } from "vitest";
import { expectedWitnessHash } from "@/lib/checkout/witness";

vi.mock("@/lib/rate/limiter", () => ({
  takeToken: vi.fn(async () => true),
}));

const TEST_INVOICE_ID = "0x" + "ab".repeat(32);
const TEST_RELAYER = (process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? "0x9999999999999999999999999999999999999999") as `0x${string}`;
const TEST_WITNESS = expectedWitnessHash(TEST_INVOICE_ID as `0x${string}`, TEST_RELAYER);
const TEST_PAYER   = "0x" + "11".repeat(20);

const invoiceRow = {
  id:          TEST_INVOICE_ID,
  status:      "created",
  payInToken:  "0x3600000000000000000000000000000000000000",
  payoutToken: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  amountOut:   "100000000",
  expiresAt:   new Date(Date.now() + 60 * 60_000),
};

const validAuthRow = () => ({
  id:           "auth-id-1",
  invoiceId:    TEST_INVOICE_ID,
  payer:        TEST_PAYER,
  payInToken:   "0x3600000000000000000000000000000000000000",
  minAmountIn:  "100000",                                // matches validBody amountIn
  expiresAt:    new Date(Date.now() + 5 * 60_000),
  consumedAt:   null,
  createdAt:    new Date(),
});

const dbState: {
  invoiceRows:  typeof invoiceRow[];
  authRows:     ReturnType<typeof validAuthRow>[];
  consumeReturn: { id: string }[];     // empty array → consume race lost
  insertThrows: Error | null;          // simulate partial unique index violation
  insertedRows: unknown[];
  // Sequential read counters: 1=invoice select, 2=auth select.
  selectCalls: number;
} = {
  invoiceRows:  [invoiceRow],
  authRows:     [validAuthRow()],
  consumeReturn: [{ id: "auth-id-1" }],
  insertThrows: null,
  insertedRows: [],
  selectCalls:  0,
};

vi.mock("@/lib/db/client", () => {
  // Builder with full chain — select/from/where/orderBy/limit; insert/values/returning;
  // update/set/where/returning. select.limit() resolves to the next batch from dbState
  // based on call order (invoice first, auth second).
  const builder = {
    select:    vi.fn(() => builder),
    from:      vi.fn(() => builder),
    where:     vi.fn(() => builder),
    orderBy:   vi.fn(() => builder),
    limit:     vi.fn(async () => {
      dbState.selectCalls++;
      if (dbState.selectCalls === 1) return dbState.invoiceRows;
      return dbState.authRows;
    }),
    insert:    vi.fn(() => builder),
    values:    vi.fn((row: unknown) => {
      if (dbState.insertThrows) throw dbState.insertThrows;
      dbState.insertedRows.push(row);
      return builder;
    }),
    update:    vi.fn(() => builder),
    set:       vi.fn(() => builder),
    returning: vi.fn(async (_arg?: unknown) => {
      // Returning is called twice in the new flow: once for auth consume, once
      // for queue insert. Auth consume returns the configured array; queue
      // insert returns a fixed sub id.
      // The auth consume update happens before the queue insert, so the first
      // returning() call is the auth consume.
      if (!builder._consumed) {
        builder._consumed = true;
        return dbState.consumeReturn;
      }
      return [{ id: "11111111-2222-3333-4444-555555555555" }];
    }),
    _consumed: false,
  } as any;
  return { db: builder };
});

// Sig verification — true by default; tests can override via the exported mock.
vi.mock("@/lib/checkout/permit2-verify", async () => {
  const actual = await vi.importActual<typeof import("@/lib/checkout/permit2-verify")>("@/lib/checkout/permit2-verify");
  return {
    ...actual,
    verifyPermit2Signature: vi.fn(async () => true),
  };
});

import { POST } from "./route";
import { db } from "@/lib/db/client";
import { verifyPermit2Signature } from "@/lib/checkout/permit2-verify";
const limiterMod = await import("@/lib/rate/limiter");

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/checkout/submit", {
    method:  "POST",
    headers: { "content-type": "application/json" },
    body:    JSON.stringify(body),
  });
}

const validBody = () => ({
  invoiceId:        TEST_INVOICE_ID,
  payer:            TEST_PAYER,
  payInToken:       "0x3600000000000000000000000000000000000000",
  amountIn:         "100000",
  permit2Data: {
    nonce:             "1",
    deadline:          String(Math.floor(Date.now() / 1000) + 600),
    witness:           TEST_WITNESS,
    witnessTypeString: "ArcoraSwapIntent witness)ArcoraSwapIntent(bytes32 invoiceId,address relayer)TokenPermissions(address token,uint256 amount)",
  },
  permit2Signature: "0x" + "ee".repeat(65),
});

beforeEach(() => {
  dbState.invoiceRows  = [invoiceRow];
  dbState.authRows     = [validAuthRow()];
  dbState.consumeReturn = [{ id: "auth-id-1" }];
  dbState.insertThrows = null;
  dbState.insertedRows = [];
  dbState.selectCalls  = 0;
  (db as any)._consumed = false;
  vi.mocked(verifyPermit2Signature).mockReset();
  vi.mocked(verifyPermit2Signature).mockResolvedValue(true);
});

describe("POST /api/checkout/submit", () => {
  it("queues a valid submission", async () => {
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.submissionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(body.statusUrl).toContain("/api/checkout/status/");
    expect(dbState.insertedRows.length).toBe(1);
  });

  it("rejects malformed payloads", async () => {
    const res = await POST(makeRequest({ invoiceId: "not-hex" }) as never);
    expect(res.status).toBe(400);
  });

  it("rejects expired permits", async () => {
    const body = validBody();
    body.permit2Data.deadline = String(Math.floor(Date.now() / 1000) - 60);
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("permit_expired");
  });

  it("rejects amountIn = 0", async () => {
    const body = validBody();
    body.amountIn = "0";
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("amount_in_out_of_range");
  });

  it("rejects amountIn beyond sane upper bound", async () => {
    const body = validBody();
    body.amountIn = (10n ** 31n).toString();
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("amount_in_out_of_range");
  });

  it("returns 404 for unknown invoice", async () => {
    dbState.invoiceRows = [];
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(404);
  });

  it("returns 409 if invoice is already paid", async () => {
    dbState.invoiceRows = [{ ...invoiceRow, status: "paid" }];
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe("paid");
  });

  it("returns 410 if invoice is past expiry", async () => {
    dbState.invoiceRows = [{ ...invoiceRow, expiresAt: new Date(Date.now() - 60_000) }];
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(410);
  });

  it("rejects payInToken mismatch", async () => {
    const body = validBody();
    body.payInToken = "0x" + "22".repeat(20);
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("pay_in_token_mismatch");
  });

  it("rejects witness hash that doesn't bind to (invoice, relayer)", async () => {
    const body = validBody();
    body.permit2Data.witness = "0x" + "00".repeat(32);
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("witness_mismatch");
  });

  it("rejects mutated witnessTypeString (relayer would burn gas on Permit2 revert)", async () => {
    const body = validBody();
    body.permit2Data.witnessTypeString = "ArcoraSwapIntent witness)Different(bytes32 invoiceId,address relayer)TokenPermissions(address token,uint256 amount)";
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("witness_type_string_mismatch");
  });

  it("rejects when no checkout_authorizations row exists for (invoice, payer)", async () => {
    dbState.authRows = [];
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("authorization_required");
  });

  it("rejects when amountIn is below the authorization floor", async () => {
    dbState.authRows = [{ ...validAuthRow(), minAmountIn: "200000" }];
    const body = validBody();
    body.amountIn = "100000";
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toBe("amount_below_floor");
    expect(j.minAmountIn).toBe("200000");
  });

  it("rejects when Permit2 signature does not recover to payer", async () => {
    vi.mocked(verifyPermit2Signature).mockResolvedValueOnce(false);
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("signature_invalid");
  });

  it("treats sig-recovery throw as invalid", async () => {
    vi.mocked(verifyPermit2Signature).mockRejectedValueOnce(new Error("recovery failed"));
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("signature_invalid");
  });

  it("returns 409 when the authorization is already consumed by a concurrent submit", async () => {
    dbState.consumeReturn = [];      // UPDATE ... WHERE consumed_at IS NULL returned no rows
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("authorization_consumed");
  });

  it("maps the relayer_queue partial unique violation to duplicate_submission", async () => {
    dbState.insertThrows = Object.assign(
      new Error("duplicate key value violates unique constraint \"uniq_relayer_queue_active_invoice\""),
      {},
    );
    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("duplicate_submission");
  });

  it("returns 429 with rate_limited when takeToken returns false (audit H1)", async () => {
    vi.mocked(limiterMod.takeToken).mockResolvedValueOnce(false);

    const res = await POST(makeRequest(validBody()) as never);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBe("60");
    expect(vi.mocked(limiterMod.takeToken)).toHaveBeenCalledWith("submit:unknown", 10, 60);
  });
});
