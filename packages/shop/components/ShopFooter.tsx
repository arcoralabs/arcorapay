export function ShopFooter() {
  return (
    <footer className="border-t border-arcora-border mt-16">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="font-[family-name:var(--font-display)] text-lg font-semibold">Arcora Shop</div>
          <p className="text-sm text-arcora-muted-fg mt-1">
            A live storefront dogfooding the Arcora checkout. Every order settles in stablecoin on Arc.
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm text-arcora-muted-fg">
          <a href="https://arcorapay.xyz" target="_blank" rel="noopener noreferrer" className="hover:text-arcora-slate transition-colors">arcorapay.xyz</a>
          <a href="https://docs.arcorapay.xyz" target="_blank" rel="noopener noreferrer" className="hover:text-arcora-slate transition-colors">docs</a>
          <span className="font-[family-name:var(--font-mono)] text-xs">testnet</span>
        </div>
      </div>
    </footer>
  );
}
