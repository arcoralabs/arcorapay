import { useCheckout } from "./useCheckout";
import type { CreateInvoiceParams, InitOptions } from "@arcora/sdk";

/**
 * Props for the drop-in checkout button.
 *
 * SECURITY: `apiKey` here MUST be your publishable key (`pk_live_…`).
 * Secret keys (`ak_…`) throw at construction time in browser contexts
 * (SDK ≥ 1.3.0). Never pass a secret key to a React component.
 */
export interface CheckoutButtonProps extends InitOptions {
  invoice: CreateInvoiceParams;
  children?: React.ReactNode;
  className?: string;
}

export function CheckoutButton({ apiKey, environment, baseUrl, invoice, children, className }: CheckoutButtonProps) {
  const { checkout, loading } = useCheckout({ apiKey, environment, baseUrl });
  return (
    <button onClick={() => checkout(invoice)} disabled={loading} className={className}>
      {children ?? (loading ? "Loading..." : "Pay")}
    </button>
  );
}
