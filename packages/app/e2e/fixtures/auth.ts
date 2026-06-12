import { sealData } from "iron-session";
import type { BrowserContext } from "@playwright/test";

/**
 * Mint and inject a merchant session cookie directly, bypassing the SIWE
 * connect-and-sign flow. The whole point of merchant-side specs is to test
 * the dashboard / treasury / refund pages — not the wallet-connect ceremony,
 * which lives in 05-siwe-auth.spec.ts and runs against a live signer.
 *
 * The cookie format / seal password / cookie name match `lib/auth/session.ts`
 * exactly — if those change, this helper has to change with them.
 */

const COOKIE_NAME = "arcfx_session";

export async function loginAsMerchant(
  context: BrowserContext,
  merchantAddress: string,
  opts: { apiKey?: string; baseURL?: string } = {},
): Promise<void> {
  const password = process.env.IRON_SESSION_PASSWORD;
  if (!password) {
    throw new Error(
      "IRON_SESSION_PASSWORD missing in test env — set it in packages/app/.env so the dev server and the test fixture seal cookies with the same key.",
    );
  }

  const sealed = await sealData(
    { merchantAddress, apiKey: opts.apiKey },
    { password, ttl: 60 * 60 * 24 }, // 24h, same shape as the iron-session default
  );

  // baseURL defaults to playwright's configured baseURL if not provided.
  const url = new URL(opts.baseURL ?? "http://localhost:3001");
  await context.addCookies([
    {
      name:    COOKIE_NAME,
      value:   sealed,
      domain:  url.hostname,
      path:    "/",
      httpOnly: true,
      sameSite: "Lax",
      secure:   url.protocol === "https:",
    },
  ]);
}
