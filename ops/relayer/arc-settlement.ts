import type { Address, Hex } from "viem";

export type ArcStableSymbol = "USDC" | "EURC";

const ARC_TOKEN_SYMBOL: Record<string, ArcStableSymbol> = {
  "0x3600000000000000000000000000000000000000": "USDC",
  "0x89b50855aa3be2f677cd6303cec089b5f319d72a": "EURC",
};

export function tokenSymbolForArcAddress(address: string): ArcStableSymbol {
  const symbol = ARC_TOKEN_SYMBOL[address.toLowerCase()];
  if (!symbol) throw new Error(`unknown Arc stable token: ${address}`);
  return symbol;
}

export function buildSettleArgs(args: {
  invoiceId: string;
  payer: string;
  payInToken: string;
  amountIn: bigint;
  grossPayout: bigint;
  swapTxHash: Hex;
}): [Hex, Address, Address, bigint, bigint, Hex] {
  return [
    args.invoiceId as Hex,
    args.payer as Address,
    args.payInToken as Address,
    args.amountIn,
    args.grossPayout,
    args.swapTxHash,
  ];
}
