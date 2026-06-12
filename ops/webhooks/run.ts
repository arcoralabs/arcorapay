import pg from "pg";
import { createHmac, createDecipheriv } from "node:crypto";
import dns from "node:dns/promises";
import { buildOpsPoolConfig, describeDbTls, assertSecureDbTls } from "./db";
import { assertAddressesPublic, postPinned } from "./ssrf";

const PG_URL    = need("POSTGRES_URL_NON_POOLING");
const MASTER_B64 = need("MASTER_KEY");
const TICK_MS   = Number(process.env.WEBHOOKS_TICK_MS ?? "10000");
const BATCH     = Number(process.env.WEBHOOKS_BATCH ?? "50");
const DELIVERY_TIMEOUT_MS = Number(process.env.WEBHOOKS_TIMEOUT_MS ?? "10000");
const MAX_BACKOFF_HOURS  = 24;
const TERMINAL_4XX_AFTER = 3;
const SIG_HEADER     = "X-Arcora-Signature";       // legacy: sha256(body)
// Audit 2026-05-24 Ops-M2 — replay protection. We dual-sign every delivery:
// the legacy header is kept verbatim so existing receivers don't break, and
// V2 (timestamp + sig-over-timestamp.body) lets receivers reject deliveries
// older than their tolerance window. WP receiver prefers V2 when present.
const SIG_HEADER_V2  = "X-Arcora-Signature-V2";    // sha256("<ts>.<body>")
const TS_HEADER      = "X-Arcora-Timestamp";       // unix seconds, ASCII

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const MASTER_KEY = (() => {
  const buf = Buffer.from(MASTER_B64, "base64");
  if (buf.length !== 32) throw new Error("MASTER_KEY must be 32 bytes (base64)");
  return buf;
})();

function decryptSecret(iv: Buffer, ciphertext: Buffer): string {
  const TAG_LEN = 16;
  const tag  = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", MASTER_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Audit 2026-05-24 Ops-M2: V2 signature binds timestamp + body so a
 *  captured webhook can't be replayed beyond the receiver's timestamp
 *  tolerance window. Dot separator matches Stripe/GitHub convention. */
function signV2(timestamp: string, body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

// AFG-011: verify-full TLS (pinned Supabase CA) — no disabled cert checks.
const _poolCfg = buildOpsPoolConfig(PG_URL);
assertSecureDbTls(_poolCfg);
console.log(`[webhooks] DB TLS: ${describeDbTls(_poolCfg)}`);
const pool = new pg.Pool(_poolCfg);

type Row = {
  id: string;
  invoice_id: string;
  url: string;
  payload: unknown;
  attempts: number;
  webhook_secret_enc: Buffer;
  webhook_secret_iv: Buffer;
};

async function fetchDue(): Promise<Row[]> {
  const r = await pool.query<Row>(
    `select wa.id, wa.invoice_id, wa.url, wa.payload, wa.attempts,
            m.webhook_secret_enc, m.webhook_secret_iv
       from webhook_attempts wa
       join invoices  i on i.id = wa.invoice_id
       join merchants m on m.id = i.merchant_id
      where wa.succeeded_at is null
        and wa.next_attempt <= now()
        and wa.terminal_reason is null
      order by wa.next_attempt
      limit $1`,
    [BATCH],
  );
  return r.rows;
}

async function markSucceeded(id: string): Promise<void> {
  await pool.query(
    "update webhook_attempts set succeeded_at = now(), next_attempt = null where id = $1",
    [id],
  );
}

async function markFailed(id: string, attempts: number, lastError: string, status: number): Promise<void> {
  const isTerminal4xx =
    status >= 400 && status < 500 && attempts >= TERMINAL_4XX_AFTER;
  if (isTerminal4xx) {
    // Audit M5 (2026-05-06): 4xx responses after TERMINAL_4XX_AFTER attempts
    // are permanently terminated. Set terminal_reason and NULL next_attempt
    // so fetchDue (which filters terminal_reason IS NULL) never re-queues
    // this row. Operator must manually clear terminal_reason to retry.
    const reason = `http_${status}`;
    await pool.query(
      `update webhook_attempts
          set attempts = $2, last_error = $3, next_attempt = null, terminal_reason = $4
        where id = $1`,
      [id, attempts, lastError, reason],
    );
  } else {
    // Audit #19: align with relayer's 2^attempts*30 schedule. The previous
    // `2 ** attempts` started at 2s and ramped slowly; during a multi-hour
    // outage that means fetchDue (10s tick × 50 rows) churns the table at
    // tens of writes per second. The relayer formula starts at 60s, doubles
    // to 30-min cap, capped harder by MAX_BACKOFF_HOURS.
    const backoffSec = Math.min(2 ** attempts * 30, MAX_BACKOFF_HOURS * 3600);
    await pool.query(
      `update webhook_attempts
          set attempts = $2, last_error = $3, next_attempt = now() + ($4 || ' seconds')::interval
        where id = $1`,
      [id, attempts, lastError, backoffSec],
    );
  }
}

// Audit pass 3 (2026-05-04): even though /api/merchant/bootstrap and
// /api/merchant/webhook PATCH now both run assertSafePublicUrl, the daemon
// re-validates immediately before fetch. Reasons it can still slip past
// app-side validation: existing rows from before the validator landed,
// direct DB edits, DNS rebinding between bootstrap and delivery time,
// resolver reconfig, redirects.
//
// AFG-002 (2026-06-06): the hand-rolled IPv6 classifier that used to live here
// missed hex v4-mapped / expanded / NAT64 / 6to4 forms. Classification now lives
// in ./ssrf (ipaddr.js, normalize-then-deny) and is shared with the pinned
// connect-time lookup.

// Audit M7 (2026-05-06): dns.lookup has no native timeout. Wrap in a 3-second
// race so a stalled resolver doesn't block the daemon loop indefinitely.
async function dnsLookupWithTimeout(
  hostname: string,
  timeoutMs = 3000,
): Promise<{ address: string; family: number }[]> {
  const lookup = dns.lookup(hostname, { all: true });
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("dns_timeout")), timeoutMs),
  );
  return Promise.race([lookup, timer]);
}

async function assertSafeAtDelivery(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unsupported_scheme");
  }
  // AFG-001: require HTTPS by default — only plain http when explicitly in
  // development. Closes the gap where the checked-in service never set
  // NODE_ENV=production, leaving the https-only branch off.
  if (parsed.protocol !== "https:" && process.env.NODE_ENV !== "development") {
    throw new Error("https_required");
  }
  const records = await dnsLookupWithTimeout(parsed.hostname).catch((e: Error) => {
    throw new Error(e.message === "dns_timeout" ? "dns_timeout" : "dns_lookup_failed");
  });
  // Early/friendly pre-check. The authoritative guard is the pinned lookup in
  // postPinned, which binds the socket to a validated address (no rebinding).
  assertAddressesPublic(records);
}

async function deliver(row: Row): Promise<{ ok: boolean; status: number; error?: string }> {
  // Re-validate the destination right before fetch — closes DNS-rebind /
  // DB-edit / pre-validator-row edge cases.
  try {
    await assertSafeAtDelivery(row.url);
  } catch (e) {
    return { ok: false, status: 0, error: `unsafe_url:${e instanceof Error ? e.message : String(e)}` };
  }

  const secret      = decryptSecret(row.webhook_secret_iv, row.webhook_secret_enc);
  const body        = JSON.stringify(row.payload);
  const timestamp   = Math.floor(Date.now() / 1000).toString();
  const signature   = sign(body, secret);
  const signatureV2 = signV2(timestamp, body, secret);

  // AFG-001: deliver over a connection PINNED to a pre-validated IP (postPinned
  // uses a custom net lookup), so the address we vet is the address the socket
  // uses — no second, unchecked DNS resolution (rebinding TOCTOU). Redirects are
  // never followed by http(s).request, so a 3xx Location to an internal IP can't
  // be chased; treat any 3xx as a delivery failure. The response body is
  // destroyed unread (Ops-M1: no buffering of a hostile/large body).
  try {
    const { status } = await postPinned(
      row.url,
      {
        "content-type":  "application/json",
        [SIG_HEADER]:    signature,    // legacy — kept for back-compat
        [TS_HEADER]:     timestamp,    // audit Ops-M2
        [SIG_HEADER_V2]: signatureV2,  // audit Ops-M2
        // Audit 2026-06-11: V1 sig (no timestamp) is replayable; migrate to
        // X-Arcora-Signature-V2. RFC 8594-style deprecation signal.
        "Deprecation": "version=1",
        "Link": '<https://arcorapay.xyz/docs/webhooks#v2>; rel="deprecation"',
      },
      body,
      DELIVERY_TIMEOUT_MS,
    );
    if (status >= 300 && status < 400) {
      return { ok: false, status, error: "redirects_blocked" };
    }
    const ok = status >= 200 && status < 300;
    return { ok, status, error: ok ? undefined : `http_${status}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network" };
  }
}

async function tick(): Promise<{ scanned: number; delivered: number; failed: number }> {
  const rows = await fetchDue();
  let delivered = 0, failed = 0;
  for (const row of rows) {
    const r = await deliver(row);
    if (r.ok) { await markSucceeded(row.id); delivered++; }
    else      { await markFailed(row.id, row.attempts + 1, r.error ?? "unknown", r.status); failed++; }
  }
  return { scanned: rows.length, delivered, failed };
}

async function main() {
  // AFG-001: surface the delivery TLS policy. https is enforced unless
  // NODE_ENV=development; deliveries are pinned to a validated IP.
  const httpsRequired = process.env.NODE_ENV !== "development";
  console.log(JSON.stringify({ msg: "webhooks.start", tickMs: TICK_MS, batch: BATCH, httpsRequired }));

  // Audit Ops-L-1 (2026-05-24): finish the current tick (BATCH=50 deliveries
  // at most) before tearing the pool down so we don't abandon a partially-
  // delivered batch mid-fetch. Each tick is short — DELIVERY_TIMEOUT_MS×50
  // worst-case — well under any sane SIGTERM grace window.
  let shuttingDown = false;
  const requestShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "webhooks.shutdown_requested", signal }));
  };
  process.on("SIGINT",  () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  while (!shuttingDown) {
    try {
      const r = await tick();
      if (r.scanned > 0) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), ...r }));
      }
    } catch (e) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), msg: "tick.error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    if (shuttingDown) break;
    await new Promise<void>(r => setTimeout(r, TICK_MS));
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "webhooks.shutdown_complete" }));
  await pool.end().catch(() => {});
  process.exit(0);
}

main();
