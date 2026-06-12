"use client";

import { QRCodeSVG } from "qrcode.react";
import { Copy, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface MobileWalletQRProps {
  url: string;
  onBack: () => void;
}

export function MobileWalletQR({ url, onBack }: MobileWalletQRProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 text-center py-4">
      <h2 className="disp text-[26px] font-medium">Scan with mobile wallet</h2>

      {/* QR must stay dark-on-white in BOTH themes so any phone camera can
          scan it — explicit hexes, never theme vars. */}
      <div
        className="mx-auto inline-block p-5 rounded-[16px]"
        style={{ background: "#ffffff" }}
      >
        <QRCodeSVG value={url} size={224} level="M" fgColor="#0D1514" bgColor="#ffffff" includeMargin={false} />
      </div>

      <p className="lead text-[13.5px] max-w-xs mx-auto">
        Open this link on your phone to complete the payment with your mobile wallet.
      </p>

      <div className="space-y-2">
        <button onClick={copy} className="pill pill--ghost inline-flex items-center gap-2">
          <Copy className="size-4" /> {copied ? "Copied!" : "Copy link"}
        </button>
      </div>

      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-[13px] text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:underline"
      >
        <ArrowLeft className="size-4" /> Back to desktop checkout
      </button>
    </div>
  );
}
