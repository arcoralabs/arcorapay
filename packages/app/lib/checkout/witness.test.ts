import { describe, it, expect } from "vitest";
import { expectedWitnessHash, ARCORA_WITNESS_TYPE_STRING, PERMIT2_WITNESS_TYPE_STRING } from "./witness";

const INVOICE = ("0x" + "ab".repeat(32)) as `0x${string}`;
const RELAYER = "0x1111111111111111111111111111111111111111" as `0x${string}`;

describe("expectedWitnessHash", () => {
  it("is deterministic for the same inputs", () => {
    expect(expectedWitnessHash(INVOICE, RELAYER)).toBe(expectedWitnessHash(INVOICE, RELAYER));
  });
  it("is 32 bytes hex", () => {
    expect(expectedWitnessHash(INVOICE, RELAYER)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("changes when the relayer changes", () => {
    const other = "0x2222222222222222222222222222222222222222" as `0x${string}`;
    expect(expectedWitnessHash(INVOICE, RELAYER)).not.toBe(expectedWitnessHash(INVOICE, other));
  });
  it("changes when the invoice id changes", () => {
    const other = ("0x" + "cd".repeat(32)) as `0x${string}`;
    expect(expectedWitnessHash(INVOICE, RELAYER)).not.toBe(expectedWitnessHash(other, RELAYER));
  });
  it("is case-insensitive on the relayer address", () => {
    expect(expectedWitnessHash(INVOICE, RELAYER.toUpperCase() as `0x${string}`))
      .toBe(expectedWitnessHash(INVOICE, RELAYER));
  });
  it("exposes the pinned Permit2 witness type string", () => {
    expect(PERMIT2_WITNESS_TYPE_STRING).toContain(ARCORA_WITNESS_TYPE_STRING);
    expect(PERMIT2_WITNESS_TYPE_STRING).toContain("TokenPermissions(address token,uint256 amount)");
  });
});
