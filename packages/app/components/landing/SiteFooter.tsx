import { ArcoraLogo } from "@/components/brand/Logo";

/**
 * Multi-column site footer used on the marketing surfaces. Every link points
 * at something that actually exists today — no placeholder /about, /security,
 * /compliance pages that 404. We add those columns when the underlying pages
 * ship.
 */

interface FooterColumn {
  title: string;
  items: Array<{ label: string; href: string; external?: boolean }>;
}

const COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    items: [
      { label: "Checkout demo", href: "/checkout-demo" },
      { label: "Merchant dashboard", href: "/m/dashboard" },
      { label: "Treasury", href: "/m/treasury" },
      { label: "Roadmap", href: "/#roadmap" },
    ],
  },
  {
    title: "Developers",
    items: [
      { label: "GitHub", href: "https://github.com/arcoralabs/arcorapay", external: true },
      { label: "@arcora/sdk", href: "https://www.npmjs.com/package/@arcora/sdk", external: true },
      { label: "@arcora/sdk-react", href: "https://www.npmjs.com/package/@arcora/sdk-react", external: true },
      { label: "Releases", href: "https://github.com/arcoralabs/arcorapay/releases", external: true },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Live merchant demo", href: "https://arc-fx-demo.vercel.app", external: true },
      { label: "Litepaper", href: "https://github.com/arcoralabs/arcorapay/blob/HEAD/docs/LITEPAPER.md", external: true },
      { label: "Specs & plans", href: "https://github.com/arcoralabs/arcorapay/tree/HEAD/docs", external: true },
      { label: "CHANGELOG", href: "https://github.com/arcoralabs/arcorapay/blob/HEAD/CHANGELOG.md", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative z-[1] border-t" style={{ background: "var(--bg-sunken)" }}>
      <div className="wrap pb-12 pt-14">
        <div className="foot-grid grid" style={{ gridTemplateColumns: "1.4fr repeat(3, 1fr)", gap: 32 }}>
          <div className="flex max-w-xs flex-col gap-4">
            <ArcoraLogo size={24} showTagline />
            <p className="lead max-w-[280px] text-[13px]">
              Stablecoin checkout &amp; settlement infrastructure. Built on Arc.
            </p>
            <span className="mono text-[11px] tracking-[0.08em]" style={{ color: "var(--fg-3)" }}>
              © 2026 Arcora · Arc testnet
            </span>
            <span className="flex items-center gap-3">
              <a href="/terms" className="navlink text-[12px]">Terms</a>
              <a href="/privacy" className="navlink text-[12px]">Privacy</a>
            </span>
          </div>
          {COLUMNS.map(col => (
            <div key={col.title} className="flex flex-col gap-3.5">
              <p className="eyebrow">{col.title}</p>
              <ul className="flex flex-col gap-2.5">
                {col.items.map(it => (
                  <li key={it.label}>
                    <a
                      href={it.href}
                      {...(it.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="navlink text-[13px]"
                    >
                      {it.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t">
        <div className="wrap mono flex flex-wrap items-center justify-between gap-2 py-4 text-[11px] tracking-[0.06em]" style={{ color: "var(--fg-3)" }}>
          <span>v1.2 · gateway 0x07BAC123…aE3a3 · arc testnet</span>
          <span><a href="https://docs.arcorapay.xyz" className="ulink">docs.arcorapay.xyz</a></span>
        </div>
      </div>
    </footer>
  );
}
