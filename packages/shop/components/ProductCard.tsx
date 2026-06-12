import Link from "next/link";
import Image from "next/image";
import type { Product } from "@/lib/products";
import { formatUsd } from "@/lib/format";

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/p/${product.slug}`}
      className="group block rounded-2xl border border-arcora-border bg-white overflow-hidden hover:shadow-[0_20px_40px_-24px_rgba(11,20,38,0.18)] transition-shadow"
    >
      <div className="relative aspect-square bg-arcora-gray overflow-hidden">
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
      </div>
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">{product.name}</h3>
          <span className="font-[family-name:var(--font-mono)] text-sm tabular-nums">{formatUsd(product.price)}</span>
        </div>
        <p className="text-sm text-arcora-muted-fg mt-1 line-clamp-1">{product.tagline}</p>
      </div>
    </Link>
  );
}
