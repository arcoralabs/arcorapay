import Link from "next/link";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Prose } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Privacy Policy · Arcorapay",
  description:
    "Privacy policy for the Arcorapay hosted testnet beta — what little data we process, and what we never do with it.",
};

const GITHUB_ISSUES = "https://github.com/arcoralabs/arcorapay/issues";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <div className="page-bg" aria-hidden="true" />

      <header className="topbar">
        <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href={"/" as Route} className="inline-flex items-center" aria-label="Arcora home">
            <ArcoraLogo size={26} />
          </Link>
          <nav className="flex items-center gap-4 sm:gap-5">
            <Link href={"/" as Route} className="navlink">Home</Link>
            <Link href={"/docs" as Route} className="navlink">Docs</Link>
            <Link href={"/terms" as Route} className="navlink whitespace-nowrap">Terms</Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <section className="relative z-[1] px-4 sm:px-6 pt-12 sm:pt-16 pb-20">
        <div className="mx-auto w-full max-w-[720px]">
          <p className="eyebrow eyebrow--acc">Legal</p>
          <h1 className="disp mt-5 mb-4" style={{ fontSize: "clamp(34px, 5vw, 48px)" }}>
            Privacy Policy
          </h1>
          <p className="lead mb-10 text-base sm:text-lg">
            Arcorapay is a testnet beta operated as an Arcora Labs product. We process very little
            data, and this page lists all of it in plain language — no accounts with emails, no
            analytics, no trackers.
          </p>

          <Prose>
            <h2>What we process</h2>
            <p>The hosted service at arcorapay.xyz processes the following, and nothing more:</p>
            <ul>
              <li>
                <strong>Public wallet addresses.</strong> Merchants sign in with their wallet
                (Sign-In with Ethereum), and payers&rsquo; addresses appear in invoices and
                settlements. Wallet addresses are already public on-chain; we store them to
                associate invoices with merchants and payments with payers.
              </li>
              <li>
                <strong>Merchant-provided configuration.</strong> What you enter in the dashboard:
                webhook URLs, allowed redirect origins, and payout preferences (which stablecoin
                you settle in). We store this to run your checkout.
              </li>
              <li>
                <strong>One session cookie.</strong> Merchant login uses a single encrypted,
                HTTP-only iron-session cookie that stores your merchant wallet address — nothing
                else. No cross-site or advertising cookies are set.
              </li>
              <li>
                <strong>Theme preference in your browser.</strong> Your light/dark choice is kept
                in your browser&rsquo;s localStorage and never sent to us. The checkout page may
                also keep transient payment-resume state in localStorage on your own device.
              </li>
              <li>
                <strong>IP addresses, transiently.</strong> IPs appear in server logs and in
                short-lived rate-limit windows used to protect the API from abuse. They are not
                used to build profiles.
              </li>
            </ul>
            <p>
              We do not collect names, email addresses, phone numbers, or any other contact or
              identity information. There is nowhere in the product to enter them.
            </p>

            <h2>What we never do</h2>
            <ul>
              <li><strong>No analytics or advertising trackers.</strong> The site ships no third-party analytics, pixels, or ad scripts.</li>
              <li><strong>No sale or sharing of data for marketing.</strong> We do not sell data, and we do not share it with anyone for marketing purposes.</li>
            </ul>

            <h2>On-chain data</h2>
            <p>
              Payments settle on Arc Testnet. Anything written to the chain — addresses, amounts,
              transaction hashes — is public and permanent by design, and is outside our control
              once broadcast. This is testnet data involving valueless test assets, but it is still
              public.
            </p>

            <h2>How long we keep data</h2>
            <ul>
              <li>
                <strong>Database data</strong> (invoices, merchant configuration, rate-limit
                counters) lives until the next testnet reset. As a beta, the service may be reset
                at any time, which clears this data.
              </li>
              <li>
                <strong>Server logs</strong> (which can include IP addresses) rotate on our hosting
                provider&rsquo;s standard schedule and are not archived long-term.
              </li>
            </ul>

            <h2>Third parties that process data for us</h2>
            <ul>
              <li>
                <strong>Vercel</strong> — hosts the application and serves requests, so it sees
                standard request metadata (IP, headers) as any host does.
              </li>
              <li>
                <strong>Circle App Kit</strong> — executes FX quotes and swaps during settlement;
                it sees the on-chain details of those swaps (token amounts and addresses).
              </li>
              <li>
                <strong>Public RPC providers</strong> — the service reads chain state through
                public Arc Testnet RPC endpoints, which see the addresses being queried.
              </li>
            </ul>
            <p>
              Each of these processes data to operate the service — not for marketing — and is
              governed by its own privacy policy.
            </p>

            <h2>Your choices</h2>
            <p>
              If you are a merchant and want your configuration and invoices removed, open an issue
              at{" "}
              <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
                github.com/arcoralabs/arcorapay/issues
              </a>{" "}
              and include a message signed with the merchant wallet (the same wallet you sign in
              with) so we can verify ownership — we will then delete the database records we hold
              for it. Note that on-chain testnet data cannot be deleted by
              anyone. You can clear the session cookie and localStorage entries in your browser at
              any time.
            </p>

            <h2>Changes to this policy</h2>
            <p>
              If what we process changes, we will update this page and the &ldquo;last
              updated&rdquo; date below. Since the service is a beta, expect this page to evolve
              with it.
            </p>

            <hr />
            <p className="mono text-[12px]" style={{ color: "var(--fg-3)" }}>
              Last updated 2026-06-10
            </p>
          </Prose>
        </div>
      </section>
    </main>
  );
}
