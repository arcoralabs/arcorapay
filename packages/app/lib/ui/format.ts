const TOKEN_ADDR_TO_SYMBOL: Record<string, string> = {
  [(process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "").toLowerCase()]: "USDC",
  [(process.env.NEXT_PUBLIC_EURC_ADDRESS ?? "").toLowerCase()]: "EURC",
};

const SYMBOL_TO_FIAT: Record<string, string> = { USDC: "USD", EURC: "EUR" };
const FIAT_TO_SIGN: Record<string, string> = { USD: "$", EUR: "€" };

/** Convert raw 6-decimal string to human-readable currency. */
export function formatCurrency(rawUnits: string | bigint, tokenAddr: string): string {
  const units = typeof rawUnits === "string" ? BigInt(rawUnits) : rawUnits;
  const symbol = TOKEN_ADDR_TO_SYMBOL[tokenAddr.toLowerCase()] ?? "TOKEN";
  const fiat = SYMBOL_TO_FIAT[symbol] ?? "";
  const sign = FIAT_TO_SIGN[fiat] ?? "";
  const major = Number(units) / 1e6;
  return `${sign}${major.toFixed(2)}`;
}

export function formatTokenAmount(rawUnits: string | bigint, decimals = 6): string {
  const units = typeof rawUnits === "string" ? BigInt(rawUnits) : rawUnits;
  const major = Number(units) / 10 ** decimals;
  return major.toFixed(Math.min(decimals, 4));
}

export function symbolForAddress(addr: string): string {
  return TOKEN_ADDR_TO_SYMBOL[addr.toLowerCase()] ?? "TOKEN";
}

export function abbreviateAddress(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatRelativeTime(date: Date | string): string {
  const t = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.round((Date.now() - t.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return t.toLocaleDateString();
}
