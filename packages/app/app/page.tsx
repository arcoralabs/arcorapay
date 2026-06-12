import Link from "next/link";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";
import { Coin } from "@/components/ui/Coin";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { LiveSettlement } from "@/components/landing/LiveSettlement";
import { DashboardPreview } from "@/components/landing/DashboardPreview";
import { SDKBlock } from "@/components/landing/SDKBlock";
import { CrosschainRouteDiagram } from "@/components/landing/CrosschainRouteDiagram";
import { SiteFooter } from "@/components/landing/SiteFooter";

const PILLARS = [
  {
    label: "Secure",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6l7-3z" />
      </svg>
    ),
    body: "Settlement runs through audited Arc primitives. No custody, no off-chain credit; funds either land in the merchant's wallet or refund to the payer.",
  },
  {
    label: "Fast",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 2 4.5 13.5h6L11 22l8.5-11.5h-6L13 2z" />
      </svg>
    ),
    body: "One signature, no transaction for the customer. Live FX from Arc's App Kit Swap — Circle's RFQ-backed maker network — settles sub-30s.",
  },
  {
    label: "Global",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M2.5 12h19M12 2.5c2.7 2.6 4 5.8 4 9.5s-1.3 6.9-4 9.5c-2.7-2.6-4-5.8-4-9.5s1.3-6.9 4-9.5z" />
      </svg>
    ),
    body: "Stablecoin-native rails. Accept USDC or EURC anywhere, settle in the stablecoin you choose. Crosschain reach via App Kit Bridge on the roadmap.",
  },
] as const;

const TRUST_ITEMS = [
  "Circle App Kit Swap",
  "Permit2 · gas-less",
  "CCTP v2 ready",
  "USDC · EURC live",
  "SIWE merchant auth",
  "Elliptic / TRM screening",
  "WooCommerce plugin",
  "Open-source SDK",
];

const STEPS = [
  {
    n: "01",
    title: "Merchant creates an invoice",
    body: "Three-line SDK call or one click in the dashboard. Set the amount, the stablecoin you want to receive, and the success URL — Arcora returns a hosted checkout link.",
    code: `await Arcora.createInvoice({\n  amountUsdc: 49.99,\n  payInToken: "EURC",\n  successUrl: "...",\n});`,
  },
  {
    n: "02",
    title: "Customer signs once",
    body: "The customer opens the link, connects their wallet, sees a live FX quote, and signs a single Permit2 EIP-712 message. No gas, no on-chain transaction on their side.",
    code: `wallet.signTypedData(permit2Msg);`,
  },
  {
    n: "03",
    title: "Arcora settles in seconds",
    body: "Arcora's relayer pulls the funds via Permit2, runs the FX swap on Arc's App Kit, and delivers the merchant's preferred stablecoin — minus the protocol fee. Webhook fires once the indexer sees InvoicePaid.",
    code: `→ kit.swap(USDC → EURC)\n→ gateway.settleInvoice\n→ webhook invoice.paid`,
  },
] as const;

type Phase = "shipped" | "next" | "later";

const ROADMAP_ITEMS: Array<{ tag: string; phase: Phase; title: string; body: string }> = [
  {
    tag: "v1.0",
    phase: "shipped",
    title: "Hosted checkout & merchant dashboard",
    body: "Gas-less Permit2 checkout driving Circle's App Kit Swap on Arc, SIWE auth, refunds, treasury view, npm SDK, WooCommerce plugin. Live on Arc testnet.",
  },
  {
    tag: "v1.1",
    phase: "shipped",
    title: "Custody escrow & Vault-backed relayer",
    body: "Escrow-per-invoice settlement with a 7-day refund window and permissionless claim, admin recovery, compliance gate (Phase 0), relayer key isolated in HashiCorp Vault.",
  },
  {
    tag: "v1.2",
    phase: "shipped",
    title: "Hardening, UI v2 & public beta",
    body: "Internal-audit findings remediated off-chain, browser-safe publishable keys, rate limiting + SSRF guards, UI v2 redesign — public testnet beta live at arcorapay.xyz.",
  },
  {
    tag: "v2.0",
    phase: "next",
    title: "Crosschain checkout via App Kit Bridge",
    body: "Customer pays USDC from another chain, merchant still settles on Arc. Feature-flagged demo in development against Sepolia / Base Sepolia, CCTP attestation flow.",
  },
  {
    tag: "T-0",
    phase: "later",
    title: "Mainnet — gated on Arc",
    body: "Hard-gated on Arc Network mainnet plus our pre-mainnet checklist: external audit, multisig admin, KYB, HSM signing, real price feeds, compliance provider activation.",
  },
  {
    tag: "v2.x",
    phase: "later",
    title: "Any token, any source chain",
    body: "Source-side DEX aggregation (native ETH, any ERC-20) and non-EVM sources — Solana wallet stack, native CCTP routes — before bridging to Arc settlement.",
  },
  {
    tag: "v3.0",
    phase: "later",
    title: "One-signature intents",
    body: "User signs a single intent; an Arcora solver executes the full route. The one-signature endgame.",
  },
];

const TOKENS = [
  { sym: "USDC", rate: "1.0000", state: "live" },
  { sym: "EURC", rate: "1.0863", state: "live" },
  { sym: "USDT", rate: "1.0001", state: "v1.x" },
  { sym: "PYUSD", rate: "1.0000", state: "v1.x" },
  { sym: "DAI", rate: "1.0003", state: "v1.x" },
  { sym: "TRYC", rate: "0.0291", state: "later" },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <div className="page-bg" aria-hidden="true" />
      <div className="grid-tex" aria-hidden="true" />

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="wrap flex h-16 items-center justify-between gap-4">
          <ArcoraLogo size={26} />
          <nav className="nav-links flex items-center gap-6">
            <a href="#how-it-works" className="navlink">How it works</a>
            <a href="#dashboard" className="navlink">Dashboard</a>
            <a href="#developers" className="navlink">Developers</a>
            <a href="#roadmap" className="navlink">Roadmap</a>
            <Link href={"/docs" as Route} className="navlink">Docs</Link>
            <a href="https://github.com/arcoralabs/arcorapay" className="navlink">GitHub</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <a href="/m/login" className="pill pill--sm pill--ghost hide-sm">Merchant sign in</a>
            <Link href={"/quickstart" as Route} className="pill pill--sm pill--acc">Test in 10 min</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="section" style={{ paddingTop: 88, paddingBottom: 72 }}>
        <div className="wrap">
          <div
            className="hero-grid grid items-center"
            style={{ gridTemplateColumns: "1.05fr 0.95fr", gap: 64 }}
          >
            <div>
              <div className="mb-6 flex flex-wrap gap-2.5">
                <span className="tagchip"><span className="dot dot--live" /> v1.2 live · Arc testnet</span>
                <span className="tagchip tagchip--mut">One signature · zero gas</span>
              </div>
              <h1 className="disp mb-6" style={{ fontSize: "clamp(44px, 6vw, 76px)" }}>
                Accept any stablecoin.<br />
                Settle the one you <em>want.</em>
              </h1>
              <p className="lead mb-8 max-w-[540px] text-[17px]">
                Arcorapay gives global businesses a checkout that quotes live FX, settles
                on-chain in seconds, and pays out in your stablecoin of choice — the customer
                signs once, with no gas and no transaction.
              </p>
              <div className="mb-8 flex flex-wrap gap-3">
                <Link href={"/quickstart" as Route} className="pill pill--lg pill--acc">Test in 10 min</Link>
                <Link href="/checkout-demo" className="pill pill--lg pill--ghost">Try the checkout</Link>
                <a href="https://github.com/arcoralabs/arcorapay" className="pill pill--lg pill--ghost hide-sm">View on GitHub</a>
              </div>
              {/* Honest trust line — test count (suite currently runs 438; intentionally rounded down), no fabricated logos */}
              <div className="mono flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] tracking-[0.04em]" style={{ color: "var(--fg-3)" }}>
                <span className="inline-flex items-center gap-2">
                  <span className="dot dot--live" />
                  <a href="https://github.com/arcoralabs/arcorapay" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--fg-1)]">400+ tests passing</a>
                </span>
                <span>
                  · <a href="https://github.com/arcoralabs/arcorapay/blob/HEAD/SECURITY.md" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--fg-1)]">internally audited</a>
                  {" · "}
                  <a href="https://github.com/arcoralabs/arcorapay" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--fg-1)]">open-source</a>
                  {" · sub-30s settlement"}
                </span>
                <a href="https://arc-fx-demo.vercel.app" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--fg-1)]">live merchant demo →</a>
              </div>
            </div>

            <HeroCheckoutCard />
          </div>
        </div>
      </section>

      {/* ── Trust marquee ────────────────────────────────────────────────── */}
      <div className="relative z-[1]">
        <div className="divider" />
        <div
          className="overflow-hidden py-5"
          style={{
            maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
            WebkitMaskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
          }}
        >
          <div className="marquee mono text-[12px] uppercase tracking-[0.1em]" style={{ color: "var(--fg-3)" }}>
            <div className="marquee-group">
              {TRUST_ITEMS.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-3 whitespace-nowrap">
                  <span className="dot" style={{ background: "var(--sage)" }} />
                  {t}
                </span>
              ))}
            </div>
            <div className="marquee-group" aria-hidden="true">
              {TRUST_ITEMS.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-3 whitespace-nowrap">
                  <span className="dot" style={{ background: "var(--sage)" }} />
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="divider" />
      </div>

      {/* ── Live settlement simulator ────────────────────────────────────── */}
      <section className="section">
        <div className="wrap">
          <div className="mb-8 max-w-[640px]">
            <p className="eyebrow eyebrow--acc mb-4">Settlement replay</p>
            <h2 className="disp" style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>
              Real flow. Real math. <em>Arc testnet.</em>
            </h2>
          </div>
          <LiveSettlement />
          <p className="mono mx-auto mt-4 max-w-[720px] text-center text-[11px] tracking-[0.04em]" style={{ color: "var(--fg-3)" }}>
            Replay of the v0.8 pay-flow on Arc Testnet — quote from Circle&apos;s App Kit Swap, deterministic merchant payout from the deployed gateway. No fictional volumes.
          </p>
        </div>
      </section>

      {/* ── Pillars ──────────────────────────────────────────────────────── */}
      <section className="section section--tight" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="g3 grid gap-[18px]" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {PILLARS.map(p => (
              <div key={p.label} className="card lift flex flex-col items-start p-7">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-[12px] border bg-[var(--acc-soft)] border-[var(--acc-line)]"
                  style={{ color: "color-mix(in oklch, var(--acc) 75%, var(--fg-1))" }}
                >
                  {p.icon}
                </span>
                <span className="eyebrow eyebrow--acc mt-5 mb-3">{p.label}</span>
                <p className="lead text-[14.5px]">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="section scroll-mt-20" style={{ paddingTop: 32 }}>
        <div className="wrap">
          <div className="mb-11 max-w-[720px]">
            <p className="eyebrow eyebrow--acc mb-4">How it works</p>
            <h2 className="disp" style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>
              Three steps from invoice to <em>settlement.</em>
            </h2>
          </div>

          <ol className="g3 grid gap-[18px]" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {STEPS.map(step => (
              <li key={step.n} className="card lift flex min-h-[360px] flex-col gap-3.5 p-7">
                <span className="mono text-[13px] font-semibold tracking-[0.1em]" style={{ color: "var(--sage)" }}>
                  {step.n}
                </span>
                <h3 className="text-[21px] font-semibold tracking-[-0.01em]">{step.title}</h3>
                <p className="lead flex-1 text-[14px]">{step.body}</p>
                <div className="code-pane px-4 py-3.5">
                  {step.code.split("\n").map((l, j) => (
                    <div key={j} className="mono text-[12px]" style={{ color: l.startsWith("→") ? "var(--sage)" : "var(--fg-2)" }}>
                      {l}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/checkout-demo" className="pill pill--acc">Try the checkout demo →</Link>
            <a href="https://arc-fx-demo.vercel.app" target="_blank" rel="noopener noreferrer" className="pill pill--ghost">
              Live merchant demo
            </a>
          </div>
          <p className="mono mt-4 text-[12px]" style={{ color: "var(--fg-3)" }}>
            Checkout demo opens in a separate page so you can step through the flow without leaving the marketing context.
          </p>
        </div>
      </section>

      {/* ── Dashboard preview ────────────────────────────────────────────── */}
      <section id="dashboard" className="section scroll-mt-20">
        <div className="wrap">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-[560px]">
              <p className="eyebrow eyebrow--acc mb-3.5">Merchant dashboard</p>
              <h2 className="disp mb-3.5" style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>
                Treasury that reads like a <em>P&amp;L.</em>
              </h2>
              <p className="lead max-w-[520px] text-[16px]">
                Every payment, every refund, every payout — reconciled to the second.
                Filter by currency, chain, or merchant of record.
              </p>
            </div>
            <a href="/m/dashboard" className="pill pill--ghost shrink-0">Open dashboard →</a>
          </div>
          <DashboardPreview />
          <p className="mono mt-3 text-right text-[11px] tracking-[0.04em]" style={{ color: "var(--fg-3)" }}>
            Illustrative · numbers above are sample shapes. Your real treasury sits at <Link href="/m/treasury" className="ulink">/m/treasury</Link>.
          </p>
        </div>
      </section>

      {/* ── Developer SDK ────────────────────────────────────────────────── */}
      <section id="developers" className="section scroll-mt-20 border-y" style={{ background: "var(--bg-sunken)" }}>
        <div className="wrap">
          <SDKBlock />
        </div>
      </section>

      {/* ── Roadmap ──────────────────────────────────────────────────────── */}
      <section id="roadmap" className="section scroll-mt-20">
        <div className="wrap">
          <p className="eyebrow eyebrow--acc mb-4">Roadmap</p>
          <h2 className="disp max-w-[640px]" style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>
            Outward, signature by <em>signature.</em>
          </h2>
          <p className="lead mt-4 max-w-[620px] text-[16px]">
            v1 settles USDC and EURC on Arc today. Each subsequent release moves the customer-side
            surface outward — more stables, more chains, fewer signatures — without rewriting the
            stack underneath.
          </p>

          <div className="mt-10 border-t">
            {ROADMAP_ITEMS.map(item => (
              <div
                key={item.tag}
                className="grid grid-cols-1 gap-3 border-b py-6 md:grid-cols-[80px_110px_1fr_1.3fr] md:items-baseline md:gap-7"
              >
                <span className="mono text-[14px] font-semibold tabular-nums">{item.tag}</span>
                <span><PhaseBadge phase={item.phase} /></span>
                <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{item.title}</h3>
                <p className="lead text-[13.5px]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── v2.0 deep-dive: crosschain diagram ───────────────────────────── */}
      <section className="section border-y" style={{ background: "var(--bg-sunken)" }}>
        <div className="wrap">
          <div className="mb-2 flex flex-wrap items-baseline gap-3">
            <span className="mono text-[14px] font-semibold tabular-nums">v2.0</span>
            <PhaseBadge phase="next" />
            <span className="eyebrow ml-auto">In development · Feature-flagged demo</span>
          </div>
          <h2 className="disp mb-3.5 max-w-[640px]" style={{ fontSize: "clamp(28px, 3.6vw, 38px)" }}>
            Customer pays from anywhere. Merchant settles on Arc.
          </h2>
          <p className="lead mb-9 max-w-[640px] text-[15.5px]">
            v2.0 wires CCTP into the gateway: a customer with USDC on Ethereum, Arbitrum, Base,
            Optimism, Polygon, or any other CCTP-supported chain pays as if they were already on
            Arc. Arcora burns on the source, mints on Arc, runs the merchant&apos;s preferred swap,
            and emits the same <code className="mono text-[13px]" style={{ color: "var(--sage)" }}>InvoicePaid</code> event the v1 indexer already understands.
          </p>

          <div className="card p-7" style={{ boxShadow: "var(--elev-2)" }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="eyebrow">Source chain · Customer wallet</span>
              <span className="eyebrow hide-sm">Settlement on Arc</span>
            </div>
            <CrosschainRouteDiagram />
          </div>
        </div>
      </section>

      {/* ── v1.x token registry ──────────────────────────────────────────── */}
      <section className="section">
        <div className="wrap">
          <div className="sdk-grid grid items-start" style={{ gridTemplateColumns: "1fr 1.15fr", gap: 56 }}>
            <div>
              <div className="mb-4 flex items-baseline gap-3">
                <span className="mono text-[14px] font-semibold tabular-nums">v1.x</span>
                <PhaseBadge phase="next" />
              </div>
              <h2 className="disp mb-4" style={{ fontSize: "clamp(28px, 3.6vw, 38px)" }}>
                Any stablecoin App Kit supports.
              </h2>
              <p className="lead text-[15.5px]">
                USDC and EURC ship today. App Kit Swap on Arc already supports USDT, USDe, DAI,
                and PYUSD; turning each one on inside Arcora is a token-whitelist call on the
                gateway. No per-pair contract redeploy, no AMM to seed — the FX layer is Arc-native.
              </p>
            </div>
            <div className="card p-2" style={{ boxShadow: "var(--elev-2)" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Rate / USD</th>
                    <th style={{ textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {TOKENS.map(t => (
                    <tr key={t.sym}>
                      <td>
                        <span className="inline-flex items-center gap-2.5">
                          <Coin sym={t.sym} />
                          <span className="font-semibold">{t.sym}</span>
                        </span>
                      </td>
                      <td className="mono tabular-nums" style={{ color: "var(--fg-2)" }}>{t.rate}</td>
                      <td style={{ textAlign: "right" }}><TokenStateChip state={t.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mono px-3.5 py-3 text-[10.5px] tracking-[0.04em]" style={{ color: "var(--fg-3)" }}>
                Rates shown are illustrative — only USDC and EURC have live oracles today.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── v3.0 endgame ─────────────────────────────────────────────────── */}
      <section className="section border-y" style={{ background: "var(--color-green-990)", color: "#ECF2EF" }}>
        <div className="wrap">
          <div className="mb-5 flex items-baseline gap-3">
            <span className="mono text-[14px] tabular-nums" style={{ color: "rgba(236,242,239,0.6)" }}>v3.0</span>
            <span className="mono rounded-md border border-white/15 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.1em] text-white/70" style={{ background: "rgba(255,255,255,0.1)" }}>
              Endgame
            </span>
          </div>
          <h2 className="disp mb-5 max-w-2xl text-white" style={{ fontSize: "clamp(36px, 5vw, 58px)" }}>
            One signature. <em style={{ color: "var(--acc)" }}>Full route.</em>
          </h2>
          <p className="mb-9 max-w-2xl text-[17px] leading-[1.55]" style={{ color: "rgba(236,242,239,0.7)" }}>
            The customer signs once. An Arcora solver executes the source-chain swap, the
            App Kit Bridge route to Arc, the destination swap, and the merchant settlement —
            off the user&apos;s critical path. One signature, full route — checkout-grade UX on stablecoin rails.
          </p>
          <div className="mono max-w-[600px] rounded-2xl border border-white/10 p-6 text-[13px] leading-[1.9]" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="text-white/50">User signs:</div>
            <div className="text-white">&nbsp;&nbsp;intent · maxIn · deadline · recipient</div>
            <div className="mt-2.5 text-white/50">Arcora solver runs:</div>
            <div className="text-white">&nbsp;&nbsp;swap → bridge → swap → settle</div>
            <div className="mt-2.5 text-white/50">Merchant receives:</div>
            <div style={{ color: "var(--acc)" }}>&nbsp;&nbsp;preferred stablecoin on Arc · single InvoicePaid event</div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="section">
        <div className="wrap">
          <div
            className="card flex flex-wrap items-end justify-between gap-8 p-8 sm:p-12"
            style={{
              background: "color-mix(in oklch, var(--acc) 6%, var(--surface))",
              borderColor: "var(--acc-line)",
            }}
          >
            <div>
              <p className="eyebrow eyebrow--acc mb-4">Get started</p>
              <h2 className="disp max-w-[520px]" style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>
                Ship a checkout this afternoon. <em>Settle by morning.</em>
              </h2>
              <p className="lead mt-3.5 text-[16px]">Arc testnet is open. v1 is live; v2 is in development.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/checkout-demo" className="pill pill--lg pill--acc">Try the checkout</Link>
              <a href="https://github.com/arcoralabs/arcorapay" target="_blank" rel="noopener noreferrer" className="pill pill--lg pill--ghost">GitHub</a>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

/* Static checkout preview in the hero — presentational only, links to the live demo. */
function HeroCheckoutCard() {
  return (
    <div className="card relative p-6" style={{ boxShadow: "var(--elev-4)" }}>
      <div className="mb-4 flex items-center justify-between">
        <span className="eyebrow"><Coin sym="USDC" /> Hosted checkout</span>
        <span className="tagchip tagchip--mut">INV-1042</span>
      </div>
      <div className="field mb-3 p-4">
        <div className="eyebrow mb-2.5">You pay</div>
        <div className="flex items-center justify-between gap-3">
          <span className="mono text-[32px] font-light tracking-[-0.02em]">54.32</span>
          <span className="field inline-flex items-center gap-2 px-3 py-2" style={{ borderRadius: 999, background: "var(--surface)" }}>
            <Coin sym="USDC" /> <span className="text-sm font-semibold">USDC</span>
          </span>
        </div>
        <div className="mono mt-1.5 text-[12px]" style={{ color: "var(--fg-3)" }}>≈ $54.32</div>
      </div>
      <div className="relative z-[2] -mt-5 -mb-2 flex justify-center">
        <span className="iconbtn" style={{ background: "var(--surface)" }} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
          </svg>
        </span>
      </div>
      <div className="field mb-4 p-4">
        <div className="eyebrow mb-2.5">Merchant settles</div>
        <div className="flex items-center justify-between gap-3">
          <span className="mono text-[32px] font-light tracking-[-0.02em]">50.00</span>
          <span className="field inline-flex items-center gap-2 px-3 py-2" style={{ borderRadius: 999, background: "var(--surface)" }}>
            <Coin sym="EURC" /> <span className="text-sm font-semibold">EURC</span>
          </span>
        </div>
        <div className="mono mt-1.5 text-[12px]" style={{ color: "var(--fg-3)" }}>1 EUR = 1.0863 USD · oracle</div>
      </div>
      <Link href="/checkout-demo" className="pill pill--acc w-full">Sign once · Permit2</Link>
      <div className="steps-rail mt-3.5">
        <i className="done" />
        <i className="cur" />
        <i />
      </div>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; style: React.CSSProperties }> = {
    shipped: {
      label: "Live",
      style: { color: "var(--success)", background: "var(--success-bg)", borderColor: "color-mix(in oklch, var(--success) 30%, transparent)" },
    },
    next: {
      label: "Next",
      style: { color: "var(--sage)", background: "var(--acc-soft)", borderColor: "var(--acc-line)" },
    },
    later: {
      label: "Planned",
      style: { color: "var(--fg-3)", background: "transparent", borderColor: "var(--border)" },
    },
  };
  const { label, style } = map[phase];
  return (
    <span className="mono inline-block rounded-md border px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em]" style={style}>
      {label}
    </span>
  );
}

function TokenStateChip({ state }: { state: "live" | "v1.x" | "later" }) {
  const style: Record<string, React.CSSProperties> = {
    live: { color: "var(--success)", background: "var(--success-bg)", borderColor: "color-mix(in oklch, var(--success) 30%, transparent)" },
    "v1.x": { color: "var(--sage)", background: "var(--acc-soft)", borderColor: "var(--acc-line)" },
    later: { color: "var(--fg-3)", background: "transparent", borderColor: "var(--border)" },
  };
  return (
    <span className="mono inline-block rounded-md border px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em]" style={style[state]}>
      {state}
    </span>
  );
}
