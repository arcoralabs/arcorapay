import { NextResponse } from "next/server";

/** JSON response for authenticated data — never cacheable (audit 2026-06-11 HIGH-3). */
export function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
