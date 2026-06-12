export type Environment = "testnet" | "mainnet";
export type PayInToken = "USDC" | "EURC";

export interface Invoice {
  invoiceId: string;
  url: string;
  /** ISO-8601 timestamp after which the merchant can claim funds (V10 escrow model). */
  claimableAt?: string | null;
}

export interface EscrowSummary {
  id:          string;
  amountOut:   string;
  payoutToken: string;
  claimableAt: string | null;
  status:      "paid" | "claimed";
}

export interface CreateInvoiceParams {
  amountUsdc: number;
  payInToken: PayInToken;
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export interface InitOptions {
  apiKey: string;
  environment?: Environment;
  baseUrl?: string;
}
