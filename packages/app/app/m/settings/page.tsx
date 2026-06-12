"use client";

import { useEffect, useState } from "react";
import { ApiKeyCard } from "@/components/merchant/ApiKeyCard";
import { WebhookSettingsCard } from "@/components/merchant/WebhookSettingsCard";
import { AllowedOriginsCard } from "@/components/merchant/AllowedOriginsCard";
import { DelegateAuthCard } from "@/components/merchant/DelegateAuthCard";
import { PayoutTokenCard } from "@/components/merchant/PayoutTokenCard";

interface MerchantInfo {
  address: string;
  payoutToken: string;
  webhookUrl: string | null;
  allowedOrigins?: string[];
  publishableKey?: string;
}

export default function SettingsPage() {
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [serverWallet, setServerWallet] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function refresh() {
    setFetchError(null);
    try {
      const res = await fetch("/api/merchant");
      if (!res.ok) {
        setFetchError(res.status === 401 ? "auth_expired" : `fetch_failed_${res.status}`);
        return;
      }
      const data = await res.json();
      setMerchant(data.merchant);
      setServerWallet(process.env.NEXT_PUBLIC_SERVER_WALLET_ADDRESS ?? null);
    } catch {
      setFetchError("network");
    }
  }
  useEffect(() => { void refresh(); }, []);

  return (
    <main className="px-6 md:px-10 py-8 md:py-10 pb-20 max-w-[760px]">
      {/* Page header */}
      <div className="border-b border-[var(--border)] pb-[18px] mb-[26px]">
        <h1 className="disp text-[30px] font-medium m-0">Settings</h1>
        <div className="mono text-[11px] text-[var(--fg-3)] mt-2 tracking-[.04em]">
          API keys · payout · webhooks · delegate auth
        </div>
      </div>
      {fetchError && (
        <div className="rounded-[var(--radius-field)] border border-[color-mix(in_oklch,var(--warning)_40%,transparent)] bg-[var(--warning-bg)] p-4 text-sm text-[var(--fg-1)] mb-[18px]">
          <div className="font-semibold mb-1">Couldn&apos;t load your merchant profile</div>
          {fetchError === "auth_expired"
            ? <>Your session has expired. <a href="/m/login" className="text-[var(--action)] underline">Sign in again</a>.</>
            : <>Network blip — retry, or check your connection.</>}
          {fetchError !== "auth_expired" && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void refresh()}
                className="pill pill--ghost pill--sm"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-col gap-[18px]">
        <ApiKeyCard hasMerchant={!!merchant} publishableKey={merchant?.publishableKey} onBootstrap={refresh} />
        {merchant && (
          <PayoutTokenCard
            currentPayoutToken={merchant.payoutToken}
            onUpdated={refresh}
          />
        )}
        {merchant && <AllowedOriginsCard initialOrigins={merchant.allowedOrigins ?? []} />}
        {merchant && <WebhookSettingsCard initialUrl={merchant.webhookUrl} />}
        <DelegateAuthCard serverWalletAddress={serverWallet} />
      </div>
    </main>
  );
}
