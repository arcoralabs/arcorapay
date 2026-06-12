import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LookupFunction } from "node:net";
import { postPinned } from "./ssrf.js";

// Permissive lookup so we can exercise postPinned's HTTP mechanics against a
// local server (the real pinnedLookup would block 127.0.0.1, as it should).
// net.connect calls lookup with { all: true } and expects an array; mirror the
// shape pinnedLookup returns.
const localLookup: LookupFunction = ((_h: string, o: any, cb: any) => {
  if (o && o.all) return cb(null, [{ address: "127.0.0.1", family: 4 }]);
  cb(null, "127.0.0.1", 4);
}) as any;

let server: http.Server;
afterEach(() => server?.close());

function listen(handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

describe("postPinned HTTP mechanics", () => {
  it("POSTs the body + headers and returns the status", async () => {
    let received = "";
    let sigHeader = "";
    const port = await listen((req, res) => {
      sigHeader = String(req.headers["x-arcora-signature-v2"] ?? "");
      req.on("data", (c) => (received += c));
      req.on("end", () => { res.statusCode = 200; res.end("ok"); });
    });
    const { status } = await postPinned(
      `http://localhost:${port}/hook`,
      { "content-type": "application/json", "x-arcora-signature-v2": "sig123" },
      JSON.stringify({ hello: "world" }),
      5000,
      localLookup,
    );
    expect(status).toBe(200);
    expect(JSON.parse(received)).toEqual({ hello: "world" });
    expect(sigHeader).toBe("sig123");
  });

  it("returns 3xx status without following the redirect", async () => {
    let hits = 0;
    const port = await listen((req, res) => {
      hits++;
      res.statusCode = 302;
      res.setHeader("location", "http://127.0.0.1:1/internal");
      res.end();
    });
    const { status } = await postPinned(`http://localhost:${port}/hook`, {}, "{}", 5000, localLookup);
    expect(status).toBe(302);
    expect(hits).toBe(1); // not followed
  });

  it("rejects on timeout for a hung peer", async () => {
    const port = await listen(() => { /* never responds */ });
    await expect(
      postPinned(`http://localhost:${port}/hook`, {}, "{}", 150, localLookup),
    ).rejects.toThrow(/timeout/i);
  });
});
