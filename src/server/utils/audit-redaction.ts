/**
 * Audit Redaction Utility
 *
 * Removes sensitive fields from objects before writing them to audit logs.
 * This ensures passwords, tokens, secrets, and other sensitive data
 * never appear in the audit trail.
 */

const REDACTED_FIELDS = new Set([
  "password",
  "passwordHash",
  "newPassword",
  "currentPassword",
  "confirmPassword",
  "token",
  "sessionToken",
  "accessToken",
  "refreshToken",
  "authToken",
  "apiKey",
  "secret",
  "clientSecret",
  "databaseUrl",
  "DATABASE_URL",
  "AUTH_SECRET",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "cookie",
  "authorization",
  "smsContent",
  "rawSms",
  "fullAccountNumber",
  "cvv",
  "pin",
]);

const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * Deeply redacts sensitive fields from an object.
 * Records changed fields only when possible (before/after approach).
 */
export function redactSensitiveFields<T extends Record<string, unknown>>(
  obj: T | null | undefined
): Record<string, unknown> | null {
  if (!obj) return null;

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(key)) {
      redacted[key] = REDACTED_PLACEHOLDER;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Computes a diff between before and after states,
 * returning only changed fields (redacted).
 * Financial amount fields are kept in full.
 */
export function computeAuditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): { before: Record<string, unknown> | null; after: Record<string, unknown> | null } {
  const redactedBefore = redactSensitiveFields(before);
  const redactedAfter = redactSensitiveFields(after);

  // If both snapshots exist, return only changed fields to reduce bloat
  if (redactedBefore && redactedAfter) {
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};

    const allKeys = new Set([
      ...Object.keys(redactedBefore),
      ...Object.keys(redactedAfter),
    ]);

    for (const key of allKeys) {
      const oldVal = redactedBefore[key];
      const newVal = redactedAfter[key];
      const strOld = typeof oldVal === "object" ? JSON.stringify(oldVal) : String(oldVal ?? "");
      const strNew = typeof newVal === "object" ? JSON.stringify(newVal) : String(newVal ?? "");

      if (strOld !== strNew) {
        changedBefore[key] = oldVal;
        changedAfter[key] = newVal;
      }
    }

    return { before: changedBefore, after: changedAfter };
  }

  return { before: redactedBefore, after: redactedAfter };
}
