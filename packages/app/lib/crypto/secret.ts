import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const k = process.env.MASTER_KEY;
  if (!k) throw new Error("MASTER_KEY missing");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error("MASTER_KEY must be 32 bytes (base64)");
  return buf;
}

export function encrypt(plaintext: string): { iv: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ciphertext: Buffer.concat([enc, tag]) };
}

export function decrypt(iv: Buffer, ciphertext: Buffer): string {
  const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const data = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
