import { z } from "zod";

// AFG-009 (2026-06-06): amount fields used to be `z.string().regex(/^\d+.../)`
// with no length cap, so a multi-megabyte digit string flowed into BigInt()
// before any numeric ceiling — burning CPU per request. Cap the STRING LENGTH
// first (a cheap check that rejects oversized input before the regex/BigInt),
// plus a digit-count bound that still admits the largest in-domain value
// (base units up to 10**30 = 31 digits; human amounts far smaller).
export const MAX_AMOUNT_STR_LEN = 64;
const MAX_INT_DIGITS = 40;
const MAX_FRAC_DIGITS = 18;

const DECIMAL_RE = new RegExp(`^\\d{1,${MAX_INT_DIGITS}}(\\.\\d{1,${MAX_FRAC_DIGITS}})?$`);
const INTEGER_RE = new RegExp(`^\\d{1,${MAX_INT_DIGITS}}$`);

/** Decimal amount string (optional fraction), length- and precision-bounded. */
export const decimalAmount = (msg = "invalid decimal amount") =>
  z.string().max(MAX_AMOUNT_STR_LEN).regex(DECIMAL_RE, msg);

/** Base-units integer amount string, length-bounded. */
export const integerAmount = (msg = "invalid integer amount") =>
  z.string().max(MAX_AMOUNT_STR_LEN).regex(INTEGER_RE, msg);
