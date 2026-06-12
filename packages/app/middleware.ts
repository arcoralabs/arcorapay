import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "./lib/security/headers";

const DOCS_HOST = "docs.arcorapay.xyz";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const url = req.nextUrl;

  // Per-request CSP nonce (audit MED-5). Forwarded on the request headers so
  // that (a) Next's renderer reads the nonce from the Content-Security-Policy
  // request header and tags its own inline runtime scripts with it, and
  // (b) server components can fetch it via `headers().get("x-nonce")` if they
  // ever need to render an inline <script>.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // docs.arcorapay.xyz/* → the app's /docs/*
  // Subdomain rewrite so the hosted docs serve from a clean URL.
  if (host === DOCS_HOST && !url.pathname.startsWith("/docs")) {
    const target = url.clone();
    target.pathname = url.pathname === "/" ? "/docs" : `/docs${url.pathname}`;
    const res = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);

  // Existing behaviour: surface the requested pathname on /m/ routes so the
  // server layout can decide whether to redirect un-authed users to /m/login.
  if (url.pathname.startsWith("/m/")) {
    res.headers.set("x-pathname", url.pathname);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
