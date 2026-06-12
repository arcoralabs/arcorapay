import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/security/csrf";

export async function POST(req: NextRequest) {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    // Fail closed — a localhost fallback in prod would redirect into oblivion
    // and (worse) trains the wrong default for any future use of this env.
    return NextResponse.json({ error: "public_base_url_unset" }, { status: 500 });
  }

  // CSRF guard: a session-bound logout is still vulnerable to a cross-site
  // form POST that forcibly signs the merchant out mid-flow. CRIT-1
  // (2026-06-11): de-duplicated into the shared, fail-closed helper. No JSON
  // content-type gate — logout is a plain HTML <form method="POST"> submit
  // (x-www-form-urlencoded) from the dashboard layout/sidebar.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "csrf" }, { status: 403 });
  }

  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL("/m/login", publicBaseUrl));
}
