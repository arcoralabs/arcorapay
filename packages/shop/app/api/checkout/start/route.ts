import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProduct } from "@/lib/products";

// AFG-003 (2026-06-06): the cart used to arrive with client-supplied price/name
// and the invoice amount was computed from them — a buyer could pay $0.01 for a
// $99.90 cart. The request now carries ONLY sku + bounded qty + option; price,
// name and the total are resolved from the server-owned catalog.
const MAX_QTY_PER_LINE = 10;
const MAX_LINES = 20;

const Body = z.object({
  // Extra keys (a client-sent price/name) are stripped by zod, not trusted.
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        qty: z.number().int().min(1).max(MAX_QTY_PER_LINE),
        size: z.string().optional(),
      }),
    )
    .min(1)
    .max(MAX_LINES),
  address: z.object({
    email: z.string().email(),
    fullName: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().min(1),
  }),
  payIn: z.enum(["USDC", "EURC"]),
});

// AFG-004 (2026-06-06): the endpoint is anonymous and spends the shop's
// server-held key + server-wallet gas per call. Best-effort per-IP throttle as
// defense-in-depth. NOTE: serverless instances don't share this Map, so it only
// bounds bursts within a warm instance; the real cap is the upstream per-merchant
// 60/min limit on /api/invoices. A durable limiter (KV) is the follow-up.
const RATE_MAX = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function rateOk(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ARCORA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "shop_not_configured" }, { status: 500 });
  }
  const arcoraBase = process.env.ARCORA_BASE_URL ?? "https://arcorapay.xyz";

  if (!rateOk(clientIp(req), Date.now())) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_body", detail: parsed.error?.format() }, { status: 400 });
  }
  const { items, address: a, payIn } = parsed.data;

  // Resolve every line against the server catalog. Reject unknown SKUs and
  // sizes the product doesn't offer; price/name come from the catalog only.
  const lines: { sku: string; name: string; price: number; qty: number; size?: string }[] = [];
  for (const it of items) {
    const p = getProduct(it.sku);
    if (!p) {
      return NextResponse.json({ error: "unknown_sku", sku: it.sku }, { status: 400 });
    }
    if (p.sizes) {
      if (!it.size || !p.sizes.includes(it.size)) {
        return NextResponse.json({ error: "bad_size", sku: it.sku }, { status: 400 });
      }
    }
    lines.push({
      sku: p.slug,
      name: p.name,
      price: p.price,
      qty: it.qty,
      size: p.sizes ? it.size : undefined,
    });
  }

  const subtotal = lines.reduce((acc, l) => acc + l.price * l.qty, 0);
  const amountUsdc = Math.round(subtotal * 100) / 100;

  const origin =
    process.env.NEXT_PUBLIC_SHOP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    new URL(req.url).origin;

  const successUrl = `${origin}/success`;
  const cancelUrl = `${origin}/cart`;
  const orderRef = `shop_${crypto.randomUUID()}`;

  // Metadata is built from server-trusted catalog data (name/price), flattened
  // to the string-record shape /api/invoices accepts.
  const itemsCompact = lines.map((l) => ({
    sku: l.sku,
    name: l.name,
    qty: l.qty,
    size: l.size,
    lineTotal: +(l.price * l.qty).toFixed(2),
  }));
  const itemsSummary = lines
    .map((l) => `${l.qty}× ${l.name}${l.size ? ` (${l.size})` : ""}`)
    .join(", ");

  const metadata: Record<string, string> = {
    source: "arcora-shop",
    order_ref: orderRef,
    items_summary: itemsSummary,
    items_json: JSON.stringify(itemsCompact),
    shipping_email: a.email,
    shipping_name: a.fullName,
    shipping_line1: a.line1,
    shipping_city: a.city,
    shipping_postal: a.postalCode,
    shipping_country: a.country,
  };
  if (a.line2) metadata.shipping_line2 = a.line2;

  let arcoraRes: Response;
  try {
    arcoraRes = await fetch(`${arcoraBase}/api/invoices`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Arcora-Api-Key": apiKey,
      },
      body: JSON.stringify({ amountUsdc, payInToken: payIn, successUrl, cancelUrl, metadata }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "arcora_unreachable", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const arcoraJson = await arcoraRes.json().catch(() => ({}));
  if (!arcoraRes.ok) {
    return NextResponse.json(
      { error: "arcora_create_failed", status: arcoraRes.status, detail: arcoraJson },
      { status: 502 },
    );
  }

  return NextResponse.json({
    invoiceId: arcoraJson.invoiceId,
    url: arcoraJson.url,
    orderRef,
  });
}
