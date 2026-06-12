import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { PRODUCTS, getProduct } from "@/lib/products";
import { AddToCartForm } from "@/components/AddToCartForm";
import { formatUsd } from "@/lib/format";

export function generateStaticParams() {
  return PRODUCTS.map(p => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) return {};
  return {
    title:       `${product.name} · Arcora Shop`,
    description: product.tagline,
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();

  return (
    <main className="px-6 py-10 max-w-6xl mx-auto">
      <Link href="/" className="text-sm text-arcora-muted-fg hover:text-arcora-slate transition-colors">
        ← All products
      </Link>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
        <div className="rounded-3xl bg-arcora-gray overflow-hidden relative aspect-square">
          <Image src={product.image} alt={product.name} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
        </div>

        <div className="space-y-6">
          <div>
            <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] uppercase text-arcora-muted-fg">
              Arcora · merch
            </p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl sm:text-5xl font-semibold tracking-tight">
              {product.name}
            </h1>
            <p className="mt-3 text-arcora-muted-fg text-lg">{product.tagline}</p>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="font-[family-name:var(--font-display)] text-3xl font-semibold tabular-nums">
              {formatUsd(product.price)}
            </span>
            <span className="text-sm text-arcora-muted-fg">USD-equivalent · USDC or EURC accepted</span>
          </div>

          <p className="text-arcora-slate leading-relaxed">{product.description}</p>

          <AddToCartForm product={product} />

          <div className="pt-6 border-t border-arcora-border space-y-2 text-sm text-arcora-muted-fg">
            <p>· Worldwide shipping, 5–10 business days.</p>
            <p>· Refunds on-chain via Arcora&apos;s built-in refund flow.</p>
            <p>· Settles in stablecoin on Arc Network.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
