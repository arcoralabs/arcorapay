import { describe, it, expect } from "vitest";
import { decimalAmount, integerAmount, MAX_AMOUNT_STR_LEN } from "./amount";

describe("amount validators (AFG-009)", () => {
  const dec = decimalAmount();
  const int = integerAmount();

  it("decimalAmount accepts normal decimal strings", () => {
    for (const s of ["0", "9.99", "1000000.123456", "1", "42.5"]) {
      expect(dec.safeParse(s).success).toBe(true);
    }
  });

  it("decimalAmount rejects junk and >18 fractional digits", () => {
    for (const s of ["", "1e5", "abc", ".5", "1.", "1.1234567890123456789", "-1"]) {
      expect(dec.safeParse(s).success).toBe(false);
    }
  });

  it("integerAmount accepts base-unit integers, rejects decimals/junk", () => {
    expect(int.safeParse("1000000000000000000").success).toBe(true);
    for (const s of ["1.5", "abc", "", "0x10"]) {
      expect(int.safeParse(s).success).toBe(false);
    }
  });

  it("rejects an over-long digit string cheaply BEFORE any BigInt (the AFG-009 DoS)", () => {
    const huge = "1".repeat(5_000_000); // ~5MB
    expect(dec.safeParse(huge).success).toBe(false);
    expect(int.safeParse(huge).success).toBe(false);
    // a string just over the cap also fails
    expect(int.safeParse("1".repeat(MAX_AMOUNT_STR_LEN + 1)).success).toBe(false);
  });

  it("accepts the largest in-domain base-units value (10**30, 31 digits)", () => {
    expect(int.safeParse("1" + "0".repeat(30)).success).toBe(true);
  });
});
