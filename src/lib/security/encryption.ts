import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM helpers for encrypting a secret that must be recoverable in
 * plaintext later (e.g. a Gmail OAuth refresh token, needed to call
 * Google's API) — a different primitive from ImportSettingService's
 * one-way SHA-256 token hashing, which only ever needs to verify a match,
 * never recover the original value.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // 96-bit IV, the recommended size for GCM

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function resolveKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error(
      `Invalid encryption key length: expected 32 bytes (64 hex chars), got ${key.length} bytes. Generate one with: openssl rand -hex 32`
    );
  }
  return key;
}

export function encryptToken(plaintext: string, keyHex: string): EncryptedPayload {
  const key = resolveKey(keyHex);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptToken(payload: EncryptedPayload, keyHex: string): string {
  const key = resolveKey(keyHex);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "hex")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
