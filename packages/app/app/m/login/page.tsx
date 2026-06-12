import Link from "next/link";
import { ConnectMerchantButton } from "@/components/merchant/ConnectMerchantButton";
import { ArcoraLogo } from "@/components/brand/Logo";

export default function LoginPage() {
  return (
    <main className="relative min-h-screen grid place-items-center px-6 bg-[var(--bg)]">
      <div className="page-bg" aria-hidden="true" />
      <div className="card relative z-[1] w-full max-w-[420px] p-8 sm:p-9">
        <ArcoraLogo size={30} />
        <h1 className="disp text-[28px] font-medium mt-6">Merchant sign in</h1>
        <p className="lead text-[14px] mt-3">
          Authenticate with your wallet — Sign-In with Ethereum, no passwords.
          Your address is your account.
        </p>
        <div className="mt-7">
          <ConnectMerchantButton />
        </div>
        <p className="mono text-[11px] text-[var(--fg-3)] text-center mt-6 leading-relaxed">
          Connect your wallet to manage invoices and webhooks.{" "}
          <Link href="/" className="text-[var(--action)] hover:underline whitespace-nowrap">
            ← Back to site
          </Link>
        </p>
      </div>
    </main>
  );
}
