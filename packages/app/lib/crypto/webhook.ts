import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhook(body: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${mac}`;
}

export function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expected = signWebhook(body, secret);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
