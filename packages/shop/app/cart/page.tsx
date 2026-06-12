"use client";

import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/lib/cart";
import { formatUsd } from "@/lib/format";
import { Trash2 } from "lucide-react";

export default function CartPage() {
  const { items, subtotal, setQty, remove, keyOf } = useCart();

  if (items.length === 0) {
    return (
      <main className="px-6 py-20 max-w-3xl mx-auto text-center">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold">Your cart is empty</h1>
        <p className="mt-3 text-arcora-muted-fg">Pick something from the shop and come back.</p>
        <Link href="/" className="btn-pill mt-8 inline-flex">Browse products →</Link>
      </main>
    );
  }

  return (
    <main className="px-6 py-10 max-w-5xl mx-auto">
      <h1 className="font-[family-name:var(--font-display)] text-4xl font-semibold mb-8">Your cart</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 items-start">
        <ul className="divide-y divide-arcora-border border-y border-arcora-border">
          {items.map(item => {
            const k = keyOf(item);
            return (
              <li key={k} className="py-5 flex gap-4 items-center">
                <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-arcora-gray shrink-0">
                  <Image src={item.image} alt={item.name} fill sizes="80px" className="object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/p/${item.sku}`} className="font-semibold hover:text-arcora-blue transition-colors">
                    {item.name}
                  </Link>
                  {item.size && <div className="text-sm text-arcora-muted-fg">Size: {item.size}</div>}
                  <div className="font-[family-name:var(--font-mono)] text-sm tabular-nums mt-0.5">
                    {formatUsd(item.price)}
                  </div>
                </div>
                <div className="inline-flex items-center rounded-full border border-arcora-border">
                  <button onClick={() => setQty(k, item.qty - 1)} className="w-8 h-8 hover:bg-arcora-gray rounded-l-full">−</button>
                  <span className="w-8 text-center font-[family-name:var(--font-mono)] tabular-nums">{item.qty}</span>
                  <button onClick={() => setQty(k, item.qty + 1)} className="w-8 h-8 hover:bg-arcora-gray rounded-r-full">+</button>
                </div>
                <div className="font-[family-name:var(--font-mono)] tabular-nums w-20 text-right">
                  {formatUsd(item.price * item.qty)}
                </div>
                <button onClick={() => remove(k)} aria-label="Remove" className="text-arcora-muted-fg hover:text-red-600 transition-colors p-2">
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>

        <aside className="rounded-2xl border border-arcora-border p-6 bg-white lg:sticky lg:top-24 space-y-4">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">Summary</h2>
          <Row label="Subtotal" value={formatUsd(subtotal)} />
          <Row label="Shipping" value="Free" muted />
          <hr className="border-arcora-border" />
          <Row label="Total" value={formatUsd(subtotal)} bold />
          <Link href="/checkout" className="btn-pill w-full">Continue to checkout →</Link>
          <p className="text-xs text-arcora-muted-fg text-center">
            Pay in USDC or EURC at the next step.
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
