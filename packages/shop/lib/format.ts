export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
