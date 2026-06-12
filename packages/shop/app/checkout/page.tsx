"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/lib/cart";
import { formatUsd } from "@/lib/format";
import { AddressForm, type ShippingAddress } from "@/components/AddressForm";
import { Loader2 } from "lucide-react";

const EMPTY_ADDRESS: ShippingAddress = {
  email: "", fullName: "", line1: "", line2: "", city: "", postalCode: "", country: "",
};

export default function CheckoutPage() {
  const router = useRouter();
  const { items, subtotal } = useCart();
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const [payIn, setPayIn] = useState<"USDC" | "EURC">("USDC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <main className="px-6 py-20 max-w-3xl mx-auto text-center">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">Cart is empty</h1>
        <Link href="/" className="btn-pill mt-6 inline-flex">Browse products →</Link>
      </main>
    );
  }

  function valid(): boolean {
    return Boolean(address.email && address.fullName && address.line1 && address.city && address.postalCode && address.country);
  }

  async function pay() {
    if (!valid()) {
      setError("Please complete the shipping address first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/start", {
        method:  "POST",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ items, address, payIn }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.detail?.error ?? data.detail?.message ?? data.message;
        throw new Error(detail ? `${data.error}: ${detail}` : (data.error ?? "checkout_failed"));
      }
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <main className="px-6 py-10 max-w-5xl mx-auto">
      <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold mb-8">Checkout</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10 items-start">
        <section className="space-y-8">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold mb-4">Shipping address</h2>
            <AddressForm value={address} onChange={setAddress} />
          </div>

          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold mb-4">Pay with</h2>
            <div className="grid grid-cols-2 gap-3">
              {(["USDC", "EURC"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPayIn(t)}
                  className={`rounded-2xl border p-5 text-left transition-colors ${
                    payIn === t ? "border-arcora-blue bg-arcora-blue/5" : "border-arcora-border hover:border-arcora-slate"
                  }`}
                >
                  <div className="font-[family-name:var(--font-display)] text-lg font-semibold">{t}</div>
                  <div className="text-xs text-arcora-muted-fg mt-1">on Arc testnet</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-arcora-muted-fg mt-3">
              Sign one Permit2 message at the next step. Same-token (USDC) settles direct; EURC routes through App Kit Swap on Arc.
            </p>
          </div>
        </section>

        <aside className="rounded-2xl border border-arcora-border p-6 bg-white lg:sticky lg:top-24 space-y-4">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">Order summary</h2>
          <ul className="space-y-3 max-h-72 overflow-auto pr-1">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-arcora-gray shrink-0">
                  <Image src={it.image} alt={it.name} fill sizes="48px" className="object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{it.name}</div>
                  <div className="text-xs text-arcora-muted-fg">
                    {it.size && <>Size {it.size} · </>}Qty {it.qty}
                  </div>
                </div>
                <div className="font-[family-name:var(--font-mono)] tabular-nums text-xs">{formatUsd(it.price * it.qty)}</div>
              </li>
            ))}
          </ul>
          <hr className="border-arcora-border" />
          <Row label="Subtotal" value={formatUsd(subtotal)} />
          <Row label="Shipping" value="Free" muted />
          <Row label="Total" value={formatUsd(subtotal)} bold />
          <button onClick={pay} disabled={busy} className="btn-pill w-full">
            {busy ? <><Loader2 className="size-4 animate-spin" />Starting checkout…</> : <>Pay with Arcora →</>}
          </button>
          {error && (
            <p className="text-xs text-red-700 text-center">{error}</p>
          )}
          <p className="text-[11px] text-arcora-muted-fg text-center">
            Redirected to <span className="font-mono">arcorapay.xyz</span> · powered by Arcora.
          </p>
        </aside>
      </div>
    </main>
  );
}

function Row({ label, value, muted, bold }: { label: string; value: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className={muted ? "text-arcora-muted-fg" : ""}>{label}</span>
      <span className={`tabular-nums font-[family-name:var(--font-mono)] ${bold ? "text-base font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
