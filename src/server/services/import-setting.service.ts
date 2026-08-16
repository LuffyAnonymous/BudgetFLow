/**
 * src/server/services/import-setting.service.ts
 *
 * Manages ImportSetting records and per-user SMS import tokens.
 *
 * Token design (hardened for Milestone 7.1):
 *   - Format:  "bf_import_" + 64 lowercase hex chars (32 random bytes)
 *   - Storage: only the SHA-256 hash is stored (tokenHash @unique)
 *   - Expiry:  tokenExpiresAt = now() + TOKEN_EXPIRY_DAYS (default 365 days)
 *   - Plaintext returned exactly once — on generate() or rotate()
 *   - Token comparison uses crypto.timingSafeEqual to prevent timing attacks
 *   - Revoked tokens (tokenRevokedAt set) are always rejected
 *   - Expired tokens (tokenExpiresAt < now) are always rejected
 *
 * tokenLastUsedAt update policy (correction #7):
 *   - Updated only when the stored value is older than TOKEN_LAST_USED_THROTTLE_MS (5 min)
 *   - This avoids a DB write on every single valid webhook request
 *   - Only called AFTER the full auth check passes (correction #6)
 *
 * Rotation (correction #5):
 *   - Atomic in a single Prisma transaction
 *   - Old token is invalid the instant the transaction commits
 *   - No window of dual-token validity
 *
 * Security notes:
 *   - Error messages are deliberately generic to avoid account enumeration
 *   - Token generation/rotation is audited
 *   - Revocation is audited
 */

import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { AuditAction, AuditEntityType, ImportStatus, type ImportSetting } from "@prisma/client";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_PREFIX = "bf_import_";
/** Default token lifetime in days */
const TOKEN_EXPIRY_DAYS = parseInt(
  process.env.IMPORT_TOKEN_EXPIRY_DAYS ?? "365",
  10
);
/** Throttle: only update tokenLastUsedAt if the stored value is older than this */
const TOKEN_LAST_USED_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
/** How long a Telegram "/link <code>" code stays valid */
const TELEGRAM_LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Token helpers ────────────────────────────────────────────────────────────

function generatePlaintextToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("hex");
}

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

function compareTokens(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function tokenExpiryDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + TOKEN_EXPIRY_DAYS);
  return d;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ImportSettingService {
  /** Get or create the import setting for a user */
  async getOrCreate(userId: string): Promise<ImportSetting> {
    const existing = await db.importSetting.findUnique({ where: { userId } });
    if (existing) return existing;
    return db.importSetting.create({ data: { userId } });
  }

  /** Update import settings */
  async update(
    userId: string,
    data: {
      enabled?: boolean;
      autoImportSalary?: boolean;
      senderAllowlist?: string[];
      salaryCategoryId?: string | null;
      expectedCurrency?: string;
      minimumAmount?: number | null;
      maximumAmount?: number | null;
      rawPayloadRetentionDays?: number;
      amountBoundsWaived?: boolean;
    }
  ): Promise<ImportSetting> {
    const setting = await this.getOrCreate(userId);

    // ── Safety gate: autoImportSalary=true requires pre-conditions (Check #10) ──
    if (data.autoImportSalary === true) {
      const errors: string[] = [];

      // 1. At least one real import must have been reviewed and confirmed
      const confirmedCount = await db.importedTransaction.count({
        where: {
          userId,
          status: ImportStatus.PROCESSED,
          transactionId: { not: null }, // confirmed (not auto-processed)
        },
      });
      if (confirmedCount === 0) {
        errors.push(
          "At least one import must be manually reviewed and confirmed before enabling automatic import."
        );
      }

      // 2. Sender matching must be configured
      const senders = data.senderAllowlist ?? setting.senderAllowlist ?? [];
      if (senders.length === 0) {
        errors.push("Sender allowlist must be configured before enabling automatic import.");
      }

      // 3. Salary category must be set (from data or existing setting)
      const categoryId = data.salaryCategoryId ?? setting.salaryCategoryId;
      if (!categoryId) {
        errors.push("Salary category must be configured before enabling automatic import.");
      }

      // 4. Amount bounds must be set or explicitly waived
      const hasMinAmount =
        data.minimumAmount != null || setting.minimumAmount != null;
      const hasMaxAmount =
        data.maximumAmount != null || setting.maximumAmount != null;
      const boundsWaived = data.amountBoundsWaived === true;

      if (!hasMinAmount || !hasMaxAmount) {
        if (!boundsWaived) {
          errors.push(
            "Minimum and maximum expected salary amount must be configured, or explicitly waived via amountBoundsWaived=true."
          );
        }
      }

      if (errors.length > 0) {
        const safeError = new Error(errors.join(" | "));
        (safeError as Error & { code: string }).code = "AUTO_IMPORT_PRECONDITIONS_NOT_MET";
        throw safeError;
      }
    }

    // Strip internal-only field before persisting (amountBoundsWaived is intentionally discarded)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { amountBoundsWaived, ...persistData } = data;
    return db.importSetting.update({ where: { userId }, data: persistData });
  }

  // ─── Token Management ───────────────────────────────────────────────────────

  /**
   * Generates a new import token.
   * Atomically clears any previous token before writing the new hash.
   * Returns the plaintext token — this is the ONLY time it is available.
   */
  async generateToken(userId: string): Promise<{ plaintext: string }> {
    const plaintext = generatePlaintextToken();
    const tokenHash = hashToken(plaintext);
    const now = new Date();
    const expiresAt = tokenExpiryDate();

    await db.$transaction(async (tx) => {
      await tx.importSetting.upsert({
        where: { userId },
        create: {
          userId,
          tokenHash,
          tokenCreatedAt: now,
          tokenRevokedAt: null,
          tokenExpiresAt: expiresAt,
          tokenLastUsedAt: null,
        },
        update: {
          tokenHash,
          tokenCreatedAt: now,
          tokenRevokedAt: null,
          tokenExpiresAt: expiresAt,
          tokenLastUsedAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.IMPORT_TOKEN_GENERATED,
          entityType: AuditEntityType.IMPORT_SETTING,
          source: "WEB",
          metadata: {
            tokenCreatedAt: now.toISOString(),
            tokenExpiresAt: expiresAt.toISOString(),
          },
        },
      });
    });

    return { plaintext };
  }

  /**
   * Atomically rotates the import token.
   *   1. Load the user's ImportSetting
   *   2. Generate new token
   *   3. Replace tokenHash, set tokenCreatedAt + tokenExpiresAt
   *   4. Clear tokenLastUsedAt and tokenRevokedAt
   *   5. Write audit entry
   *   6. Commit — old token is invalid from this moment
   *
   * Plaintext returned exactly once. The old token is rejected immediately.
   */
  async rotateToken(userId: string): Promise<{ plaintext: string }> {
    const plaintext = generatePlaintextToken();
    const tokenHash = hashToken(plaintext);
    const now = new Date();
    const expiresAt = tokenExpiryDate();

    await db.$transaction(async (tx) => {
      // Verify the setting exists and is owned by this user
      const setting = await tx.importSetting.findUnique({
        where: { userId },
        select: { userId: true },
      });

      if (!setting) {
        throw new Error("IMPORT_SETTING_NOT_FOUND");
      }

      await tx.importSetting.update({
        where: { userId },
        data: {
          tokenHash,
          tokenCreatedAt: now,
          tokenRevokedAt: null,
          tokenExpiresAt: expiresAt,
          tokenLastUsedAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.IMPORT_TOKEN_GENERATED,
          entityType: AuditEntityType.IMPORT_SETTING,
          source: "WEB",
          metadata: {
            operation: "rotate",
            tokenCreatedAt: now.toISOString(),
            tokenExpiresAt: expiresAt.toISOString(),
          },
        },
      });
    });

    return { plaintext };
  }

  /**
   * Revokes the current import token.
   * After revocation all webhook requests using the old token are rejected.
   */
  async revokeToken(userId: string): Promise<void> {
    const setting = await db.importSetting.findUnique({
      where: { userId },
      select: { tokenHash: true },
    });

    if (!setting?.tokenHash) return;

    await db.$transaction(async (tx) => {
      await tx.importSetting.update({
        where: { userId },
        data: { tokenRevokedAt: new Date(), tokenHash: null },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.IMPORT_TOKEN_REVOKED,
          entityType: AuditEntityType.IMPORT_SETTING,
          source: "WEB",
          metadata: { revokedAt: new Date().toISOString() },
        },
      });
    });
  }

  /**
   * Returns token status metadata (never the hash or plaintext).
   */
  async getTokenStatus(userId: string): Promise<{
    hasToken: boolean;
    createdAt: Date | null;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    isActive: boolean;
    isExpired: boolean;
  }> {
    const setting = await db.importSetting.findUnique({
      where: { userId },
      select: {
        tokenHash: true,
        tokenCreatedAt: true,
        tokenExpiresAt: true,
        tokenLastUsedAt: true,
        tokenRevokedAt: true,
      },
    });

    const hasToken = !!setting?.tokenHash;
    const isRevoked = !!setting?.tokenRevokedAt;
    const isExpired = !!setting?.tokenExpiresAt && setting.tokenExpiresAt < new Date();
    const isActive = hasToken && !isRevoked && !isExpired;

    return {
      hasToken,
      createdAt: setting?.tokenCreatedAt ?? null,
      expiresAt: setting?.tokenExpiresAt ?? null,
      lastUsedAt: setting?.tokenLastUsedAt ?? null,
      revokedAt: setting?.tokenRevokedAt ?? null,
      isActive,
      isExpired,
    };
  }

  // ─── Token Resolution (for webhook auth) ────────────────────────────────────

  /**
   * Resolves a userId from a raw Bearer token.
   * Returns null if the token is missing, invalid, revoked, or expired.
   * Error messages are deliberately generic.
   */
  async resolveUserFromToken(rawToken: string | null): Promise<string | null> {
    console.log("[Auth Debug] resolveUserFromToken invoked. Has token:", !!rawToken);
    if (!rawToken) return null;

    const startsWithPrefix = rawToken.startsWith(TOKEN_PREFIX);
    console.log("[Auth Debug] Token starts with bf_import_:", startsWithPrefix);
    if (!startsWithPrefix) return null;

    const candidateHash = hashToken(rawToken);
    console.log("[Auth Debug] Candidate hash prefix (first 10):", candidateHash.slice(0, 10));

    const setting = await db.importSetting.findFirst({
      where: { tokenHash: candidateHash },
      select: {
        userId: true,
        tokenHash: true,
        tokenRevokedAt: true,
        tokenExpiresAt: true,
      },
    });

    console.log("[Auth Debug] DB lookup result - setting found:", !!setting);
    if (!setting) return null;

    console.log("[Auth Debug] Setting details:", {
      userId: setting.userId,
      tokenRevokedAt: setting.tokenRevokedAt,
      tokenExpiresAt: setting.tokenExpiresAt,
      isExpired: setting.tokenExpiresAt ? setting.tokenExpiresAt < new Date() : false,
    });

    // Check revocation
    if (setting.tokenRevokedAt) {
      console.log("[Auth Debug] Token is revoked");
      return null;
    }

    // Check expiry
    if (setting.tokenExpiresAt && setting.tokenExpiresAt < new Date()) {
      console.log("[Auth Debug] Token is expired");
      return null;
    }

    // Timing-safe comparison (defense-in-depth — @unique already prevents hash collision)
    const isMatch = compareTokens(candidateHash, setting.tokenHash!);
    console.log("[Auth Debug] Timing-safe match result:", isMatch);
    if (!isMatch) return null;

    return setting.userId;
  }

  /**
   * Throttle-updates tokenLastUsedAt.
   *
   * ONLY call this AFTER full authentication succeeds:
   *   - token valid ✓
   *   - not revoked ✓
   *   - not expired ✓
   *   - import enabled ✓
   *   - request body valid (or at least parseable) ✓
   *
   * Skips the write if the stored value is <5 minutes old (correction #7).
   */
  async touchLastUsed(userId: string): Promise<void> {
    const setting = await db.importSetting.findUnique({
      where: { userId },
      select: { tokenLastUsedAt: true },
    });

    const now = new Date();
    const stored = setting?.tokenLastUsedAt;

    if (stored && now.getTime() - stored.getTime() < TOKEN_LAST_USED_THROTTLE_MS) {
      return; // Skip — recently updated
    }

    await db.importSetting.update({
      where: { userId },
      data: { tokenLastUsedAt: now },
    });
  }

  // ─── Telegram Linking ───────────────────────────────────────────────────────

  /**
   * Generates a short-lived one-time code the user sends to the bot
   * ("/link <code>") to associate their Telegram chat with this account.
   */
  async generateTelegramLinkCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
    const expiresAt = new Date(Date.now() + TELEGRAM_LINK_CODE_TTL_MS);

    await this.getOrCreate(userId);
    await db.importSetting.update({
      where: { userId },
      data: { telegramLinkCode: code, telegramLinkCodeExpiresAt: expiresAt },
    });

    return { code, expiresAt };
  }

  /** Returns whether this user currently has a linked Telegram chat. */
  async getTelegramLinkStatus(userId: string): Promise<{ isLinked: boolean }> {
    const setting = await db.importSetting.findUnique({
      where: { userId },
      select: { telegramChatId: true },
    });
    return { isLinked: !!setting?.telegramChatId };
  }

  /** Unlinks the user's Telegram chat, if any. */
  async unlinkTelegram(userId: string): Promise<void> {
    await db.importSetting.update({
      where: { userId },
      data: { telegramChatId: null, telegramLinkCode: null, telegramLinkCodeExpiresAt: null },
    });
  }
}

export const importSettingService = new ImportSettingService();
