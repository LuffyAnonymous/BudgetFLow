/**
 * src/server/services/gmail-integration.service.ts
 *
 * Manages GmailIntegration records — the per-user connected Gmail account
 * used for bank-email auto-import. Mirrors ImportSettingService's shape,
 * but holds an actual reversibly-encrypted secret (the OAuth refresh
 * token) rather than a one-way-hashed bearer token, since it must be
 * recoverable to call Google's API.
 */

import "server-only";

import { db } from "@/lib/db";
import { AuditAction, AuditEntityType, type GmailIntegration } from "@prisma/client";
import { encryptToken, decryptToken } from "@/lib/security/encryption";
import { GmailClient } from "@/lib/gmail/gmail-client";

function getEncryptionKey(): string {
  const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  return key;
}

export class GmailIntegrationService {
  async getStatus(userId: string): Promise<{
    isConnected: boolean;
    googleAccountEmail: string | null;
    status: string | null;
    lastSyncedAt: Date | null;
    watchExpiration: Date | null;
    lastErrorAt: Date | null;
    lastErrorMessage: string | null;
  }> {
    const integration = await db.gmailIntegration.findUnique({ where: { userId } });
    return {
      isConnected: !!integration && integration.status === "ACTIVE",
      googleAccountEmail: integration?.googleAccountEmail ?? null,
      status: integration?.status ?? null,
      lastSyncedAt: integration?.lastSyncedAt ?? null,
      watchExpiration: integration?.watchExpiration ?? null,
      lastErrorAt: integration?.lastErrorAt ?? null,
      lastErrorMessage: integration?.lastErrorMessage ?? null,
    };
  }

  /**
   * Upserts the connection on (re)connect. Reconnecting with a different
   * Google account overwrites the existing row by design — googleAccountEmail
   * being shown in the Settings UI is what makes an accidental account
   * switch visible, rather than silently swapping which mailbox is watched.
   */
  async saveConnection(
    userId: string,
    params: { refreshToken: string; googleAccountEmail: string | null }
  ): Promise<void> {
    const { ciphertext, iv, authTag } = encryptToken(params.refreshToken, getEncryptionKey());

    await db.$transaction(async (tx) => {
      await tx.gmailIntegration.upsert({
        where: { userId },
        create: {
          userId,
          googleAccountEmail: params.googleAccountEmail,
          encryptedRefreshToken: ciphertext,
          encryptionIv: iv,
          encryptionAuthTag: authTag,
          status: "ACTIVE",
          lastErrorAt: null,
          lastErrorMessage: null,
        },
        update: {
          googleAccountEmail: params.googleAccountEmail,
          encryptedRefreshToken: ciphertext,
          encryptionIv: iv,
          encryptionAuthTag: authTag,
          status: "ACTIVE",
          lastErrorAt: null,
          lastErrorMessage: null,
          // A fresh connection can't resume a stale History API cursor or
          // a stale watch — both get re-established right after this call
          // (see the OAuth callback route), not lazily on the next renewal.
          lastHistoryId: null,
          watchExpiration: null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.GMAIL_CONNECTED,
          entityType: AuditEntityType.GMAIL_CONNECTION,
          source: "WEB",
          metadata: { googleAccountEmail: params.googleAccountEmail },
        },
      });
    });
  }

  async disconnect(userId: string): Promise<void> {
    const integration = await db.gmailIntegration.findUnique({ where: { userId } });
    if (!integration) return;

    // Best-effort — tell Google to stop sending push notifications for
    // this mailbox. If the token is already invalid (e.g. status was
    // already ERROR from a revoked grant), this will fail harmlessly;
    // either way the integration is marked REVOKED below and won't be
    // synced against again.
    try {
      const refreshToken = await this.getDecryptedRefreshToken(integration);
      await new GmailClient(refreshToken).stopWatch();
    } catch (err) {
      console.warn("[GmailIntegrationService] stopWatch() failed on disconnect (non-fatal):", err);
    }

    await db.$transaction(async (tx) => {
      await tx.gmailIntegration.update({
        where: { userId },
        data: { status: "REVOKED" },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.GMAIL_DISCONNECTED,
          entityType: AuditEntityType.GMAIL_CONNECTION,
          source: "WEB",
          metadata: { googleAccountEmail: integration.googleAccountEmail },
        },
      });
    });
  }

  /** Plaintext refresh token — only for building a Gmail API client, never returned to a client response. */
  async getDecryptedRefreshToken(integration: GmailIntegration): Promise<string> {
    return decryptToken(
      { ciphertext: integration.encryptedRefreshToken, iv: integration.encryptionIv, authTag: integration.encryptionAuthTag },
      getEncryptionKey()
    );
  }

  async getByGoogleAccountEmail(email: string): Promise<GmailIntegration | null> {
    return db.gmailIntegration.findFirst({ where: { googleAccountEmail: email, status: "ACTIVE" } });
  }

  async listActiveIntegrations(): Promise<GmailIntegration[]> {
    return db.gmailIntegration.findMany({ where: { status: "ACTIVE" } });
  }

  /** ACTIVE integrations whose watch is missing or expiring within the given window — due for renewal. */
  async listIntegrationsNeedingWatchRenewal(withinHours: number): Promise<GmailIntegration[]> {
    const cutoff = new Date(Date.now() + withinHours * 60 * 60 * 1000);
    return db.gmailIntegration.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ watchExpiration: null }, { watchExpiration: { lt: cutoff } }],
      },
    });
  }

  async saveWatch(userId: string, params: { historyId: string; expiration: Date }): Promise<void> {
    await db.gmailIntegration.update({
      where: { userId },
      data: { watchExpiration: params.expiration, lastHistoryId: params.historyId },
    });
  }

  async markSynced(userId: string, historyId: string | null): Promise<void> {
    await db.gmailIntegration.update({
      where: { userId },
      data: { lastSyncedAt: new Date(), lastHistoryId: historyId },
    });
  }

  async markError(userId: string, message: string): Promise<void> {
    await db.gmailIntegration.update({
      where: { userId },
      data: { status: "ERROR", lastErrorAt: new Date(), lastErrorMessage: message },
    });
  }
}

export const gmailIntegrationService = new GmailIntegrationService();
