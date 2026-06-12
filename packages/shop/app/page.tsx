import { ProductCard } from "@/components/ProductCard";
import { PRODUCTS } from "@/lib/products";

export default function HomePage() {
  return (
    <main>
      <section className="px-6 py-20 sm:py-28 max-w-6xl mx-auto">
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.2em] uppercase text-arcora-muted-fg">
          A live storefront · pays in stablecoin · settles on Arc
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl sm:text-7xl tracking-tight font-semibold text-arcora-slate max-w-3xl">
          Wear the gateway.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-arcora-muted-fg">
          Caps, tees, mugs and stickers — every checkout runs through the same Arcora rails we ship to merchants.
          Pay in <strong className="text-arcora-slate">USDC or EURC</strong>; we settle the merchant in USDC. Shipping worldwide.
        </p>
      </section>

      <section className="px-6 max-w-6xl mx-auto pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PRODUCTS.map(p => <ProductCard key={p.slug} product={p} />)}
        </div>
      </section>

      <section className="border-t border-arcora-border bg-arcora-gray/30">
        <div className="px-6 py-16 max-w-6xl mx-auto grid sm:grid-cols-3 gap-10">
          <Tile title="Pay from anywhere" body="USDC and EURC accepted. Cross-stable swaps run on Arc&apos;s App Kit Swap, sub-30s end-to-end." />
          <Tile title="Settled on-chain" body="Every order is a real Arc Network invoice. Customer signs once via Permit2; the relayer handles the rest." />
          <Tile title="Real fulfillment" body="Shipping address attaches to the invoice metadata, visible to the operator in the Arcora merchant dashboard." />
        </div>
      </section>
    </main>
  );
}

function Tile({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-arcora-muted-fg leading-relaxed">{body}</p>
    </div>
  );
}
