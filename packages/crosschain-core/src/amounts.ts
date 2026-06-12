function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("decimals must be a non-negative integer");
  }
}

export function parseBaseUnits(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`invalid decimal amount: ${value}`);
  const parts = value.split(".");
  const wholeRaw = parts[0] ?? "";
  const fracRaw = parts[1] ?? "";
  if (fracRaw.length > decimals) {
    throw new Error(`too many decimal places: got ${fracRaw.length}, max ${decimals}`);
  }
  const whole = BigInt(wholeRaw);
  const frac = BigInt(fracRaw.padEnd(decimals, "0") || "0");
  return whole * 10n ** BigInt(decimals) + frac;
}

export function formatBaseUnits(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (value < 0n) throw new Error("negative amounts are not supported");
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator < 0n) throw new Error("numerator must be non-negative");
  return (numerator + denominator - 1n) / denominator;
}
