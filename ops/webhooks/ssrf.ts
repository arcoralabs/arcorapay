// AFG-001 + AFG-002 (2026-06-06): SSRF-safe webhook delivery.
//
// AFG-002: classify resolved IPs with a maintained library (ipaddr.js) so every
// textual IPv6 form — hex v4-mapped (::ffff:7f00:1), expanded, NAT64, 6to4,
// teredo — is normalized before the range check. The old hand-rolled classifier
// only caught the dotted ::ffff:127.0.0.1 form.
//
// AFG-001: pin the connection to a validated IP via a custom `lookup` so the
// address we check is the address the socket uses — no second, unchecked DNS
// resolution between validation and connect (DNS-rebinding TOCTOU).
import ipaddr from "ipaddr.js";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

/**
 * True if an IP literal is NOT a public unicast address — i.e. loopback,
 * unspecified, RFC1918 private, link-local, unique-local, CGNAT, multicast,
 * broadcast, reserved, NAT64/6to4/teredo, a v4-mapped form of any of those, or
 * unparseable. ipaddr.js normalizes every textual form before classifying.
 */
export function isBlockedAddress(ip: string): boolean {
  let addr: ReturnType<typeof ipaddr.parse>;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true; // unparseable → block, fail closed
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    // Unwrap v4-mapped (::ffff:a.b.c.d / ::ffff:hhhh:hhhh) and judge the v4.
    if (v6.isIPv4MappedAddress()) {
      return v6.toIPv4Address().range() !== "unicast";
    }
    return v6.range() !== "unicast";
  }
  return (addr as ipaddr.IPv4).range() !== "unicast";
}

/** Throw on the first non-public record (or an empty set). */
export function assertAddressesPublic(addresses: ReadonlyArray<{ address: string }>): void {
  if (addresses.length === 0) throw new Error("dns_lookup_failed");
  for (const a of addresses) {
    if (isBlockedAddress(a.address)) throw new Error(`private_address_blocked:${a.address}`);
  }
}

/**
 * A net.LookupFunction that resolves the hostname, validates EVERY returned
 * record, and hands the socket a vetted address. Because the socket connects
 * to exactly what we validated, a rebinding answer can't slip a private IP in
 * between the pre-check and the connect.
 */
export const pinnedLookup: LookupFunction = ((hostname: string, options: any, callback: any) => {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    try {
      assertAddressesPublic(addresses);
    } catch (e) {
      return callback(e as Error, "", 0);
    }
    if (options && options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}) as unknown as LookupFunction;

/**
 * POST a body to an already-scheme-checked URL with the connection pinned to a
 * validated IP. Redirects are NOT followed (http(s).request never does), so a
 * 3xx Location to an internal IP can't be chased. TLS verification stays on
 * (default) and SNI/Host use the original hostname. Only the status line is
 * read; the response body is destroyed (no buffering).
 */
export function postPinned(
  urlStr: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  lookup: LookupFunction = pinnedLookup,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      urlStr,
      {
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(body).toString() },
        lookup,
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.destroy(); // we only need the status line; never buffer the body
        resolve({ status });
      },
    );
    req.on("timeout", () => req.destroy(new Error("delivery_timeout")));
    req.on("error", (e) => reject(e));
    req.write(body);
    req.end();
  });
}
