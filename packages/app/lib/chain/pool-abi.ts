import { parseAbi } from "viem";

export const POOL_ABI = parseAbi([
  "function calculateSwap(uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 dx) view returns (uint256)",
]);
