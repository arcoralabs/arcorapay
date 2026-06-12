const PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /SlippageExceeded/, message: "Rate moved — refreshing quote" },
  { pattern: /OracleDeviation/, message: "Market disrupted — try again in a moment" },
  { pattern: /InvoiceExpired/, message: "This invoice has expired" },
  { pattern: /InvoiceAlreadyPaid/, message: "Already paid — redirecting" },
  { pattern: /User rejected/i, message: "Wallet rejected the request" },
  { pattern: /insufficient funds/i, message: "Insufficient funds for gas" },
  { pattern: /allowance/i, message: "Approval insufficient — re-approve" },
];

export function mapChainError(e: unknown): string {
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
    ?? (e as { message?: string })?.message
    ?? String(e);
  for (const { pattern, message } of PATTERNS) {
    if (pattern.test(msg)) return message;
  }
  return "Transaction failed — try again";
}
