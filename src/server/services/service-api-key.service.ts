/**
 * src/server/services/service-api-key.service.ts
 *
 * Manages ServiceApiKey records — per-user API keys for trusted automation
 * clients (n8n) that need to call authenticated BudgetFlow endpoints without
 * a browser session.
 *
 * Design mirrors ImportSettingService's import-token pattern:
 *   - Format:  "bf_svc_" + 64 lowercase hex chars (32 random bytes)
 *   - Storage: only the SHA-256 hash is stored (keyHash @unique)
 *   - Expiry:  optional, defaults to SERVICE_KEY_EXPIRY_DAYS (365 days)
 *   - Plaintext returned exactly once — on generate() or rotate()
 *   - Key comparison uses crypto.timingSafeEqual to prevent timing attacks
 *   - Revoked keys (revokedAt set) are always rejected
 *   - Expired keys (expiresAt < now) are always rejected
 *   - Scopes are least-privilege: a key only authorizes the actions it lists
 *
 * lastUsedAt update policy:
 *   - Updated only when the stored value is older than LAST_USED_THROTTLE_MS (5 min)
 *   - Only called AFTER the full auth check (including scope check) passes
 */

import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { AuditAction, AuditEntityType } from "@prisma/client";

// ─── Scopes ───────────────────────────────────────────────────────────────────

/**
 * Known automation scopes. A ServiceApiKey must include the relevant scope
 * to be authorized for that action — keys are least-privilege by default
 * (an empty scopes array authorizes nothing).
 */
export const SERVICE_API_SCOPES = [
  "transactions:write",
  "transactions:read",
  "debts:write",
  "savings:write",
  "remittances:write",
  "categories:read",
  "accounts:read",
  "accounts:write",
  "automation:trigger", // recurring evaluate, monthly rollover, notifications evaluate
] as const;

export type ServiceApiScope = (typeof SERVICE_API_SCOPES)[number];

export function isValidScope(scope: string): scope is ServiceApiScope {
  return (SERVICE_API_SCOPES as readonly string[]).includes(scope);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KEY_PREFIX = "bf_svc_";
const KEY_EXPIRY_DAYS = parseInt(process.env.SERVICE_KEY_EXPIRY_DAYS ?? "365", 10);
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

// ─── Key helpers ──────────────────────────────────────────────────────────────

function generatePlaintextKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("hex");
}

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

function compareHashes(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function keyExpiryDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + KEY_EXPIRY_DAYS);
  return d;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface ServiceApiKeyStatus {
  id: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  isActive: boolean;
  isExpired: boolean;
}

export class ServiceApiKeyService {
  /**
   * Generates a new service API key for a user.
   * A user may hold multiple keys (e.g. "n8n production", "n8n staging").
   * Returns the plaintext key — this is the ONLY time it is available.
   */
  async generateKey(
    userId: string,
    params: { name: string; scopes: string[] }
  ): Promise<{ id: string; plaintext: string }> {
    const invalidScopes = params.scopes.filter((s) => !isValidScope(s));
    if (invalidScopes.length > 0) {
      throw new Error(`INVALID_SCOPE: Unknown scope(s): ${invalidScopes.join(", ")}`);
    }

    const plaintext = generatePlaintextKey();
    const keyHash = hashKey(plaintext);
    const now = new Date();
    const expiresAt = keyExpiryDate();

    const created = await db.$transaction(async (tx) => {
      const record = await tx.serviceApiKey.create({
        data: {
          userId,
          name: params.name,
          keyHash,
          scopes: params.scopes,
          createdAt: now,
          expiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.SERVICE_KEY_GENERATED,
          entityType: AuditEntityType.SERVICE_API_KEY,
          entityId: record.id,
          source: "WEB",
          metadata: {
            name: params.name,
            scopes: params.scopes,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });

      return record;
    });

    return { id: created.id, plaintext };
  }

  /**
   * Atomically rotates a key: same id, name, and scopes, new secret.
   * The old key is invalid the instant this commits.
   */
  async rotateKey(userId: string, keyId: string): Promise<{ plaintext: string }> {
    const plaintext = generatePlaintextKey();
    const keyHash = hashKey(plaintext);
    const now = new Date();
    const expiresAt = keyExpiryDate();

    await db.$transaction(async (tx) => {
      const existing = await tx.serviceApiKey.findFirst({
        where: { id: keyId, userId },
        select: { id: true },
      });
      if (!existing) {
        throw new Error("SERVICE_API_KEY_NOT_FOUND");
      }

      await tx.serviceApiKey.update({
        where: { id: keyId },
        data: {
          keyHash,
          createdAt: now,
          expiresAt,
          revokedAt: null,
          lastUsedAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.SERVICE_KEY_GENERATED,
          entityType: AuditEntityType.SERVICE_API_KEY,
          entityId: keyId,
          source: "WEB",
          metadata: { operation: "rotate", expiresAt: expiresAt.toISOString() },
        },
      });
    });

    return { plaintext };
  }

  /** Revokes a key. After this, all requests using it are rejected. */
  async revokeKey(userId: string, keyId: string): Promise<void> {
    const existing = await db.serviceApiKey.findFirst({
      where: { id: keyId, userId },
      select: { id: true },
    });
    if (!existing) return;

    await db.$transaction(async (tx) => {
      await tx.serviceApiKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.SERVICE_KEY_REVOKED,
          entityType: AuditEntityType.SERVICE_API_KEY,
          entityId: keyId,
          source: "WEB",
          metadata: { revokedAt: new Date().toISOString() },
        },
      });
    });
  }

  /** Lists key metadata for a user — never the hash or plaintext. */
  async listKeys(userId: string): Promise<ServiceApiKeyStatus[]> {
    const keys = await db.serviceApiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    return keys.map((k) => {
      const isExpired = !!k.expiresAt && k.expiresAt < now;
      const isRevoked = !!k.revokedAt;
      return {
        id: k.id,
        name: k.name,
        scopes: k.scopes,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
        isActive: !isExpired && !isRevoked,
        isExpired,
      };
    });
  }

  // ─── Key Resolution (for service-to-service auth) ───────────────────────────

  /**
   * Resolves a userId + granted scopes from a raw Bearer key.
   * Returns null if the key is missing, malformed, unknown, revoked, or expired.
   * Error messages are deliberately generic (no account enumeration).
   */
  async resolveFromKey(
    rawKey: string | null
  ): Promise<{ userId: string; keyId: string; scopes: string[] } | null> {
    if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

    const candidateHash = hashKey(rawKey);
    const record = await db.serviceApiKey.findFirst({
      where: { keyHash: candidateHash },
      select: { id: true, userId: true, keyHash: true, scopes: true, revokedAt: true, expiresAt: true },
    });
    if (!record) return null;

    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;
    if (!compareHashes(candidateHash, record.keyHash)) return null;

    return { userId: record.userId, keyId: record.id, scopes: record.scopes };
  }

  /** Throttle-updates lastUsedAt. Call only AFTER auth + scope checks pass. */
  async touchLastUsed(keyId: string): Promise<void> {
    const record = await db.serviceApiKey.findUnique({
      where: { id: keyId },
      select: { lastUsedAt: true },
    });

    const now = new Date();
    const stored = record?.lastUsedAt;
    if (stored && now.getTime() - stored.getTime() < LAST_USED_THROTTLE_MS) {
      return;
    }

    await db.serviceApiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: now },
    });
  }
}

export const serviceApiKeyService = new ServiceApiKeyService();
