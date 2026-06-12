import Link from "next/link";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { AddArcTestnetButton } from "@/components/quickstart/AddArcTestnetButton";

const NETWORK = {
  name: "Arc Testnet",
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  symbol: "USDC",
};

const FAUCET = "https://faucet.circle.com";

const STEPS: Array<{ n: string; title: string; body: React.ReactNode }> = [
  {
    n: "01",
    title: "Add Arc Testnet to your wallet",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          Arcora settles on Arc Testnet today. One click to add the network — your wallet will prompt for confirmation.
        </p>
        <div className="mt-5">
          <AddArcTestnetButton />
        </div>
        <details className="mt-5 group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
            Or add it manually with these values
          </summary>
          <dl className="mono mt-3 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Network name</dt>
            <dd className="text-foreground">{NETWORK.name}</dd>
            <dt className="text-muted-foreground">Chain ID</dt>
            <dd className="text-foreground">{NETWORK.chainId}</dd>
            <dt className="text-muted-foreground">RPC URL</dt>
            <dd className="text-foreground break-all">{NETWORK.rpcUrl}</dd>
            <dt className="text-muted-foreground">Symbol</dt>
            <dd className="text-foreground">{NETWORK.symbol}</dd>
            <dt className="text-muted-foreground">Explorer</dt>
            <dd className="text-foreground break-all">{NETWORK.explorer}</dd>
          </dl>
        </details>
        <p className="mt-4 text-xs text-muted-foreground">
          On Arc, gas is paid in <span className="mono">USDC</span>, not ETH.
          Native USDC has 18 decimals; the ERC-20 interface (the one you&apos;ll see in dapps) is 6 decimals.
        </p>
      </>
    ),
  },
  {
    n: "02",
    title: "Get testnet USDC and EURC",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          Circle&apos;s public faucet drops both stables on Arc Testnet — pick a token, paste your wallet address, claim.
        </p>
        <a
          href={FAUCET}
          target="_blank"
          rel="noopener noreferrer"
          className="pill pill--ghost mt-5"
        >
          Open Circle Faucet →
        </a>
        <p className="mt-4 text-xs text-muted-foreground">
          You&apos;ll need a small amount of native USDC for gas plus whatever pay-in token you want to test
          (USDC or EURC). 10 of each is plenty for a few full pay/refund cycles.
        </p>
      </>
    ),
  },
  {
    n: "03",
    title: "Sign in as a merchant",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          Open the merchant portal and authenticate with Sign-In-with-Ethereum. The wallet you sign with becomes your
          merchant identity — there&apos;s no signup form on testnet, just a signature.
        </p>
        <Link href="/m/login" className="pill pill--acc mt-5">
          Open merchant portal →
        </Link>
        <p className="mt-4 text-xs text-muted-foreground">
          First time only: you&apos;ll be asked which stablecoin you want to settle in (USDC or EURC). That choice is
          frozen at registration but rotatable later for future invoices.
        </p>
      </>
    ),
  },
  {
    n: "04",
    title: "Create a test invoice",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          From the dashboard, click <span className="font-semibold">Create invoice</span>. Set the amount, the pay-in
          token (the customer&apos;s side — can be different from your payout), and a success URL. Arcora returns a
          hosted checkout link.
        </p>
        <Link href="/m/dashboard" className="pill pill--ghost mt-5">
          Go to dashboard →
        </Link>
        <p className="mt-4 text-xs text-muted-foreground">
          You can also create invoices from the SDK — see the &ldquo;Developers&rdquo; section on the home page.
        </p>
      </>
    ),
  },
  {
    n: "05",
    title: "Pay the invoice from a different wallet",
    body: (
      <>
        <p className="text-muted-foreground leading-relaxed">
          Open the invoice link in an incognito window or a different wallet. Connect, see the live FX quote, sign
          one Permit2 message — no transaction popup, no gas. Arcora&apos;s relayer handles the on-chain side.
        </p>
        <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
          Watch settlement land on the merchant dashboard&apos;s <Link href="/m/treasury" className="ulink">treasury page</Link> within ~30 seconds.
          Try a refund from the invoice row to round-trip the flow.
        </p>
      </>
    ),
  },
];

const KNOWN_ISSUES: Array<{ headline: string; detail: string }> = [
  {
    headline: "We’re on Arc Testnet only — no real money moves.",
    detail: "Arc itself is on testnet, so we are too. Mainnet T-0 is gated on Arc going mainnet. Treat this as a working preview, not a production payment rail.",
  },
  {
    headline: "Pay-in / payout tokens are USDC and EURC for now.",
    detail: "App Kit Swap on Arc Testnet supports only USDC ⇄ EURC today. USDT, PYUSD, DAI, and USDe are mainnet-only on App Kit; we’ll list them as Arc opens those on testnet or as we move to mainnet.",
  },
  {
    headline: "Refunds work until the escrow is claimed — a soft 7-day window, no merchant approval needed.",
    detail: "The custody-escrow gateway holds each settled invoice for 7 days. Refunds drain straight from the escrow without any ERC-20 allowance from the merchant. The window is soft: after 7 days anyone can call claim(globalIds[]) to release matured funds to the merchant payout address, but a refund stays callable until that claim lands — whichever transaction confirms first wins. Once claimed, the refund path closes.",
  },
  {
    headline: "Webhooks retry 5× over 30 minutes, then stop.",
    detail: "If your webhook endpoint is down longer than that, you’ll need to fetch missed events via the API. Long-term retry policy is on the v1.x list.",
  },
  {
    headline: "Compliance screening is in shadow mode.",
    detail: "The /api/checkout/authorize gate exists and logs decisions, but the active provider is Noop on testnet — no wallet is rejected today. Mainnet flips it to a real Elliptic / TRM Labs adapter via env, no code change.",
  },
  {
    headline: "Single-instance relayer.",
    detail: "One VPS handles every settle and refund. If it’s slow or briefly down, your invoice queues up and processes when it’s back. Multi-relayer with rolling failover is on the v1.x ops list.",
  },
];

export default function QuickstartPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <div className="page-bg" aria-hidden="true" />

      <header className="topbar">
        <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href={"/" as Route} className="inline-flex items-center" aria-label="Arcora home">
            <ArcoraLogo size={28} />
          </Link>
          <nav className="flex items-center gap-4 sm:gap-5">
            <Link href={"/" as Route} className="navlink">Home</Link>
            <Link href={"/m/login" as Route} className="navlink whitespace-nowrap">Merchants</Link>
            <a href="https://github.com/arcoralabs/arcorapay" className="navlink">GitHub</a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <section className="relative z-[1] px-4 sm:px-6 pt-12 sm:pt-20 pb-12">
        <div className="max-w-3xl mx-auto text-center">
          <p className="eyebrow eyebrow--acc">Tester quickstart</p>
          <h1 className="disp mt-6" style={{ fontSize: "clamp(34px, 5vw, 52px)" }}>
            From zero to a settled testnet payment in five steps.
          </h1>
          <p className="lead mt-6 text-base sm:text-lg max-w-2xl mx-auto">
            Should take ten minutes including the wallet setup. If anything sticks, open an issue on
            GitHub or email <span className="mono">support@arcorapay.xyz</span> — we&apos;d rather hear about a bug now than once
            mainnet money is moving.
          </p>
        </div>
      </section>

      <section className="relative z-[1] px-4 sm:px-6 pb-20">
        <ol className="max-w-3xl mx-auto space-y-6">
          {STEPS.map((step) => (
            <li key={step.n} className="card p-6 sm:p-8">
              <div className="flex items-baseline gap-4 mb-3">
                <span className="mono text-xs font-semibold tracking-[0.18em]" style={{ color: "var(--sage)" }}>
                  STEP {step.n}
                </span>
                <h2 className="font-semibold text-lg sm:text-xl">{step.title}</h2>
              </div>
              {step.body}
            </li>
          ))}
        </ol>
      </section>

      <section className="relative z-[1] px-4 sm:px-6 pb-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <p className="eyebrow eyebrow--acc">Known issues</p>
            <h2 className="disp mt-3" style={{ fontSize: "clamp(24px, 3vw, 28px)" }}>
              What&apos;s rough, on purpose.
            </h2>
            <p className="lead mt-3 text-sm">
              We&apos;d rather you hit these expecting them than be surprised mid-test.
            </p>
          </div>
          <ul className="space-y-4">
            {KNOWN_ISSUES.map((issue) => (
              <li key={issue.headline} className="field p-5">
                <p className="font-semibold">{issue.headline}</p>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{issue.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
