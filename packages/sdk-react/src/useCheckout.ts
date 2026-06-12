import { useCallback, useMemo, useState } from "react";
import { Arcora, type CreateInvoiceParams, type Invoice, type InitOptions } from "@arcora/sdk";

export interface UseCheckoutResult {
  checkout: (params: CreateInvoiceParams) => Promise<Invoice>;
  loading: boolean;
  error: Error | null;
  /** V10: deadline after which the merchant can claim funds; null until a paid invoice is returned. */
  refundEndsAt: Date | null;
}

export function useCheckout(opts: InitOptions): UseCheckoutResult {
  // Audit #23: `opts.environment` selects the default base URL (testnet vs
  // mainnet) when `opts.baseUrl` is unset, so a parent that swaps environments
  // mid-session must re-create the Arcora instance — otherwise the old URL
  // sticks. Include it in the dep array.
  const arcora = useMemo(
    () => new Arcora(opts),
    [opts.apiKey, opts.baseUrl, opts.environment],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  const checkout = useCallback(async (params: CreateInvoiceParams): Promise<Invoice> => {
    setLoading(true);
    setError(null);
    try {
      const inv = await arcora.createInvoice(params);
      setInvoice(inv);
      arcora.openCheckout(inv);
      return inv;
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [arcora]);

  return {
    checkout,
    loading,
    error,
    refundEndsAt: invoice?.claimableAt ? new Date(invoice.claimableAt) : null,
  };
}
