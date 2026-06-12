import Link from "next/link";
import type { Route } from "next";
import { ArcoraLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Prose } from "@/components/docs/DocsShell";

export const metadata = {
  title: "Terms of Service · Arcorapay",
  description:
    "Terms of Service for the Arcorapay hosted testnet beta — an Arcora Labs product.",
};

const GITHUB_ISSUES = "https://github.com/arcoralabs/arcorapay/issues";

export default function TermsPage() {
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
            <Link href={"/privacy" as Route} className="navlink whitespace-nowrap">Privacy</Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <section className="relative z-[1] px-4 sm:px-6 pt-12 sm:pt-16 pb-20">
        <div className="mx-auto w-full max-w-[720px]">
          <p className="eyebrow eyebrow--acc">Legal</p>
          <h1 className="disp mt-5 mb-4" style={{ fontSize: "clamp(34px, 5vw, 48px)" }}>
            Terms of Service
          </h1>
          <p className="lead mb-10 text-base sm:text-lg">
            The short version: Arcorapay is a testnet beta. Everything that moves through it is a
            test asset with no monetary value, the service comes with no guarantees, and the data
            may be reset at any time. The long version follows.
          </p>

          <Prose>
            <h2>1. Who we are</h2>
            <p>
              Arcorapay is operated as <strong>an Arcora Labs product</strong>. These terms govern
              your use of the hosted service at{" "}
              <a href="https://arcorapay.xyz">arcorapay.xyz</a> — the checkout pages, the merchant
              dashboard, and the public API (together, the &ldquo;Service&rdquo;). By using the
              Service you agree to these terms. If you do not agree, do not use the Service.
            </p>

            <h2>2. Testnet beta — no monetary value</h2>
            <p>
              The Service runs exclusively on <strong>Arc Testnet</strong>. Every token, balance,
              invoice, quote, swap, and settlement you see or create through the Service involves{" "}
              <strong>test assets only</strong>. Test assets have <strong>no monetary value</strong>,
              are not redeemable for anything of value, and do not represent money, e-money,
              deposits, securities, or any other financial instrument. Nothing in the Service is an
              offer to transmit money or provide payment services. The Service exists so that
              merchants and developers can evaluate the product before any mainnet release.
            </p>

            <h2>3. Provided &ldquo;as is&rdquo;</h2>
            <p>
              The Service is a beta and is provided <strong>&ldquo;as is&rdquo; and &ldquo;as
              available&rdquo;</strong>, without warranty of any kind — express or implied —
              including any implied warranties of merchantability, fitness for a particular purpose,
              or non-infringement. We make <strong>no service-level commitment</strong>: no uptime
              target, no support response time, and no guarantee that any invoice, webhook, swap, or
              settlement will execute, execute correctly, or execute on time. To the maximum extent
              permitted by law, Arcora Labs is not liable for any damages arising from your use of
              the Service. Since all assets involved are valueless test assets, your remedy for any
              dissatisfaction with the Service is to stop using it.
            </p>

            <h2>4. Data may be reset</h2>
            <p>
              Because this is a testnet beta, we may <strong>reset, migrate, or delete service
              data at any time without notice</strong>. This includes invoices, payment records,
              merchant accounts and their configuration (webhook URLs, allowed origins, payout
              preferences, API keys), and rate-limit state. Do not treat anything stored in the
              Service as durable. Where practical we will mention notable resets in the project
              changelog, but we are not obligated to do so.
            </p>

            <h2>5. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>use the Service for any unlawful purpose, or to present test transactions as real payments to anyone;</li>
              <li>abuse the Service — including flooding it with requests, circumventing rate limits, or interfering with other users&rsquo; ability to use it;</li>
              <li>
                attempt to exploit or disrupt the Service or its smart contracts, except as part of{" "}
                <strong>good-faith responsible disclosure</strong>: if you find a vulnerability,
                report it privately via{" "}
                <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">GitHub</a>{" "}
                (or a security advisory on the repository) instead of exploiting it;
              </li>
              <li>misrepresent your affiliation with Arcorapay or Arcora Labs.</li>
            </ul>
            <p>
              We may suspend or block access — by merchant account, API key, or IP — at our sole
              discretion, with or without notice, if we believe these terms are being violated.
            </p>

            <h2>6. Open source and the hosted service</h2>
            <p>
              The Arcorapay software is open source under the{" "}
              <strong>MIT license</strong> at{" "}
              <a href="https://github.com/arcoralabs/arcorapay" target="_blank" rel="noopener noreferrer">
                github.com/arcoralabs/arcorapay
              </a>
              . The MIT license governs your use of the <em>source code</em> — you are free to
              self-host, fork, and modify it under that license. These terms are separate: they
              govern the <em>hosted Service</em> we run at arcorapay.xyz. Using the hosted Service
              does not grant you rights beyond the MIT license, and the MIT license does not grant
              you any rights to our hosted infrastructure, branding, or data.
            </p>

            <h2>7. Changes to these terms</h2>
            <p>
              We may change these terms as the beta evolves. Material changes will be noted on this
              page with an updated &ldquo;last updated&rdquo; date. Your continued use of the
              Service after a change takes effect constitutes acceptance of the revised terms. If
              you do not accept a change, stop using the Service.
            </p>

            <h2>8. Scope of this beta</h2>
            <p>
              The Service is offered <strong>for beta evaluation only</strong>. It is not intended
              for production commerce, real customer payments, or any activity that depends on the
              Service being available or correct. When (and if) a mainnet release ships, it will be
              governed by its own terms.
            </p>

            <h2>9. Contact</h2>
            <p>
              Questions, problems, or disclosure reports: open an issue at{" "}
              <a href={GITHUB_ISSUES} target="_blank" rel="noopener noreferrer">
                github.com/arcoralabs/arcorapay/issues
              </a>
              .
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
