"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function InvoiceShareQRDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const url = typeof window !== "undefined"
    ? `${process.env.NEXT_PUBLIC_BASE_URL ?? window.location.origin}/i/${invoiceId}`
    : "";
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 2000);
  }

  function handlePrint() { window.print(); }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Share invoice</DialogTitle></DialogHeader>
        <div className="space-y-4 text-center">
          <div className="mx-auto inline-block p-[14px] bg-white rounded-[14px] print:border-0">
            <QRCodeSVG value={url} size={224} level="M" fgColor="#0D1514" bgColor="#ffffff" />
          </div>
          <code className="mono block text-xs text-[var(--fg-3)] break-all px-2">{url}</code>
          <div className="flex gap-2 justify-center print:hidden">
            <button
              type="button"
              onClick={copy}
              className="pill pill--acc pill--sm"
            >
              <Copy className="size-4" /> {copied ? "Copied!" : "Copy URL"}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="pill pill--ghost pill--sm"
            >
              <Printer className="size-4" /> Print
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
