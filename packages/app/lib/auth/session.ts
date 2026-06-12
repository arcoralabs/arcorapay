import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  merchantAddress?: string;
  // apiKey removed (Audit L9, 2026-05-06): storing a live API credential in
  // the server-side session cookie is unnecessary weight. The key is returned
  // in the response body at bootstrap / rotation (single-use reveal); the
  // caller is responsible for persisting it client-side if needed.
}

/**
 * Audit L-3 (2026-05-31): the password used to be a bare non-null assertion
 * (`process.env.IRON_SESSION_PASSWORD!`), so an unset or too-short secret only
 * surfaced lazily inside iron-session on the first request rather than at boot.
 * Validate at module load (fail-fast) and support a rotation set so the secret
 * can be rolled without invalidating live sessions: a single 32+ char string,
 * or comma-separated `id:secret` pairs ("1:secretA,2:secretB"; highest id
 * encrypts, all are tried on decrypt — iron-session's documented map form).
 */
function resolveSessionPassword(): string | Record<string, string> {
  const raw = process.env.IRON_SESSION_PASSWORD;
  if (!raw) throw new Error("IRON_SESSION_PASSWORD is required (32+ chars)");

  if (/^\s*\d+\s*:/.test(raw)) {
    const map: Record<string, string> = {};
    for (const pair of raw.split(",")) {
      const idx = pair.indexOf(":");
      const id = idx >= 0 ? pair.slice(0, idx).trim() : "";
      const secret = idx >= 0 ? pair.slice(idx + 1).trim() : "";
      if (!/^\d+$/.test(id) || secret.length < 32) {
        throw new Error("IRON_SESSION_PASSWORD rotation entries must be `id:secret` with 32+ char secrets");
      }
      map[id] = secret;
    }
    if (Object.keys(map).length === 0) throw new Error("IRON_SESSION_PASSWORD rotation set is empty");
    return map;
  }

  if (raw.length < 32) throw new Error("IRON_SESSION_PASSWORD must be at least 32 chars");
  return raw;
}

export const sessionOptions: SessionOptions = {
  password: resolveSessionPassword(),
  cookieName: "arcfx_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
