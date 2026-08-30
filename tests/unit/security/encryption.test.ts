import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "@/lib/security/encryption";

const TEST_KEY = "0".repeat(64); // 32 bytes of zeros — a valid-length test key, not a real secret
const OTHER_KEY = "1".repeat(64);

describe("encryptToken / decryptToken", () => {
  it("round-trips a plaintext value", () => {
    const plaintext = "1//09exampleRefreshTokenValueHere";
    const encrypted = encryptToken(plaintext, TEST_KEY);
    expect(decryptToken(encrypted, TEST_KEY)).toBe(plaintext);
  });

  it("produces a different ciphertext and IV on each call (random IV)", () => {
    const a = encryptToken("same-plaintext", TEST_KEY);
    const b = encryptToken("same-plaintext", TEST_KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptToken("secret-value", TEST_KEY);
    expect(() => decryptToken(encrypted, OTHER_KEY)).toThrow();
  });

  it("fails to decrypt if the auth tag was tampered with", () => {
    const encrypted = encryptToken("secret-value", TEST_KEY);
    const tampered = { ...encrypted, authTag: OTHER_KEY.slice(0, encrypted.authTag.length) };
    expect(() => decryptToken(tampered, TEST_KEY)).toThrow();
  });

  it("rejects a key that isn't 32 bytes", () => {
    expect(() => encryptToken("value", "tooshort")).toThrow(/32 bytes/);
  });
});
