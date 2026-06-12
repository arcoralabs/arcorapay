"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";
import type { Product } from "@/lib/products";
import { Check, ShoppingBag } from "lucide-react";

export function AddToCartForm({ product }: { product: Product }) {
  const router = useRouter();
  const { add } = useCart();
  const [size, setSize] = useState<string | undefined>(product.sizes?.[1]); // default M
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  function handleAdd(goToCart: boolean) {
    if (product.sizes && !size) return;
    add(
      {
        sku:   product.slug,
        name:  product.name,
        price: product.price,
        image: product.image,
        size,
      },
      qty,
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
    if (goToCart) router.push("/cart");
  }

  return (
    <div className="space-y-5">
      {product.sizes && (
        <div>
          <label className="block text-xs uppercase tracking-wider font-semibold text-arcora-muted-fg mb-2">Size</label>
          <div className="flex gap-2">
            {product.sizes.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`min-w-12 h-10 px-4 rounded-full border text-sm font-semibold transition-colors ${
                  size === s
                    ? "border-arcora-slate bg-arcora-slate text-white"
                    : "border-arcora-border hover:border-arcora-slate"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs uppercase tracking-wider font-semibold text-arcora-muted-fg mb-2">Quantity</label>
        <div className="inline-flex items-center rounded-full border border-arcora-border">
          <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} className="w-10 h-10 text-lg hover:bg-arcora-gray rounded-l-full">−</button>
          <span className="w-10 text-center font-[family-name:var(--font-mono)] tabular-nums">{qty}</span>
          <button type="button" onClick={() => setQty(q => Math.min(10, q + 1))} className="w-10 h-10 text-lg hover:bg-arcora-gray rounded-r-full">+</button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button onClick={() => handleAdd(false)} className="btn-pill-light flex-1">
          {added ? <><Check className="size-4" />Added</> : <><ShoppingBag className="size-4" />Add to cart</>}
        </button>
        <button onClick={() => handleAdd(true)} className="btn-pill flex-1">Buy now →</button>
      </div>
    </div>
  );
}
