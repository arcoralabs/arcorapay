import { formatCurrency, symbolForAddress, abbreviateAddress } from "@/lib/ui/format";
import { Coin } from "@/components/ui/Coin";
import { ExpiryCountdown } from "./ExpiryCountdown";
import type { invoiceStatus } from "@/lib/db/schema";

/** Full DB `invoice_status` enum (type-only import) — the card must badge
 *  refunded/claimed/recovered too, not silently treat them as `created`. */
type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];

interface LineItem {
  name?: string;
  description?: string;
  quantity?: number;
  amount?: number | string;
  sku?: string;
  [key: string]: unknown;
}

interface InvoiceCardProps {
  amountOut: string;
  payoutTokenAddress: string;
  payInTokenAddress: string;
  status: InvoiceStatus;
  invoiceId?: string;
  expiresAt?: Date;
  merchantAddress?: string;
  metadata?: unknown;
}

export function InvoiceCard({
  amountOut,
  payoutTokenAddress,
  payInTokenAddress,
  status,
  invoiceId,
  expiresAt,
  merchantAddress,
  metadata,
}: InvoiceCardProps) {
  const amount = formatCurrency(amountOut, payoutTokenAddress);
  const payoutSymbol = symbolForAddress(payoutTokenAddress);
  const payInSymbol = symbolForAddress(payInTokenAddress);

  // Parse line items from metadata only if they exist
  const lineItems: LineItem[] | null = (() => {
    if (!metadata || typeof metadata !== "object") return null;
    const m = metadata as Record<string, unknown>;
    if (!Array.isArray(m.lineItems) || m.lineItems.length === 0) return null;
    return m.lineItems as LineItem[];
  })();

  return (
    <div className="flex flex-col gap-5 flex-1">
      {/* Amount block */}
      <div className="flex flex-col gap-1">
        <p className="eyebrow">Invoice total</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="mono text-[32px] font-light leading-none tracking-[-0.02em] text-[var(--fg-1)]">
            {amount}
          </span>
          <Coin sym={payoutSymbol} />
        </div>
        <p className="text-[13px] text-[var(--fg-3)] mt-1">
          You&apos;ll pay in <span className="font-semibold text-[var(--fg-1)]">{payInSymbol}</span>
        </p>
        {/* claimed/recovered are custody-escrow settlements — paid, from the payer's view */}
        {(status === "paid" || status === "claimed" || status === "recovered") && <StatusBadge variant="paid" />}
        {status === "expired" && <StatusBadge variant="expired" />}
        {status === "failed" && <StatusBadge variant="failed" />}
        {status === "refunded" && <StatusBadge variant="refunded" />}
      </div>

      {/* Invoice metadata row */}
      {(invoiceId || expiresAt) && (
        <div className="mono flex flex-wrap gap-4 text-[11px] text-[var(--fg-3)] tracking-[0.04em]">
          {invoiceId && (
            <span>
              <span className="uppercase tracking-[0.1em] mr-1 opacity-60">ID</span>
              <span className="text-[var(--fg-1)]">{invoiceId.slice(0, 8)}…</span>
            </span>
          )}
          {expiresAt && (
            <ExpiryCountdown
              expiresAt={expiresAt}
              className={status === "expired" ? "text-[var(--danger)]" : ""}
            />
          )}
        </div>
      )}

      <div className="divider" />

      {/* Line items — only rendered when metadata actually carries them */}
      {lineItems && (
        <div className="flex flex-col gap-0">
          {lineItems.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-3 border-b border-[var(--border-faint)]">
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-[var(--fg-1)]">
                  {item.name ?? "Item"}
                </span>
                {item.description && (
                  <span className="mono text-[11px] text-[var(--fg-3)]">
                    {item.description}
                  </span>
                )}
                {item.sku && (
                  <span className="mono text-[11px] text-[var(--fg-3)]">
                    SKU {item.sku}{item.quantity != null ? ` · qty ${item.quantity}` : ""}
                  </span>
                )}
              </div>
              {item.amount != null && (
                <span className="mono text-[13px] font-medium text-[var(--fg-1)]">
                  {item.amount}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Merchant address footer */}
      {merchantAddress && (
        <div className="mt-auto">
          <div className="mono flex justify-between items-center text-[11px] text-[var(--fg-3)] tracking-[0.04em]">
            <span className="uppercase tracking-[0.1em]">Merchant</span>
            <span className="text-[var(--fg-1)]">{abbreviateAddress(merchantAddress)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ variant }: { variant: "paid" | "expired" | "failed" | "refunded" }) {
  if (variant === "paid") {
    return (
      <div className="mt-2">
        <span className="tagchip tagchip--ok">Paid</span>
      </div>
    );
  }
  if (variant === "failed") {
    return (
      <div className="mt-2">
        <span
          className="tagchip"
          style={{
            background: "var(--danger-bg)",
            color: "var(--danger)",
            borderColor: "color-mix(in oklch, var(--danger) 30%, transparent)",
          }}
        >
          Failed
        </span>
      </div>
    );
  }
  return (
    <div className="mt-2">
      <span className="tagchip tagchip--mut">{variant === "refunded" ? "Refunded" : "Expired"}</span>
    </div>
  );
}
