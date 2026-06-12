export type ArcoraErrorCode =
  | "INVALID_API_KEY"
  | "NETWORK"
  | "SERVER_ERROR"
  | "INVALID_URL"
  | "TIMEOUT"
  | "NO_SECURE_RANDOM"
  // AFG-019: a publishable (pk_live_) key was used on a server-only operation.
  | "PUBLISHABLE_KEY_FORBIDDEN"
  // Audit 2026-06-11 C-2: a secret (ak_) key was used in a browser context.
  | "SECRET_KEY_IN_BROWSER"
  | "UNKNOWN";

export interface ArcoraErrorOptions {
  cause?: unknown;
  retryAfter?: number;
}

export class ArcoraError extends Error {
  readonly code: ArcoraErrorCode;
  readonly retryAfter?: number;

  constructor(code: ArcoraErrorCode, message: string, opts: ArcoraErrorOptions = {}) {
    super(message, { cause: opts.cause });
    this.name = "ArcoraError";
    this.code = code;
    this.retryAfter = opts.retryAfter;
  }
}
