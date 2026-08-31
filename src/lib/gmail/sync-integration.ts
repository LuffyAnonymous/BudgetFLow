import "server-only";

import { db } from "@/lib/db";
import type { GmailIntegration } from "@prisma/client";
import { gmailIntegrationService } from "@/server/services/gmail-integration.service";
import { GmailClient } from "./gmail-client";
import { importService } from "@/imports/engine/import.service";
import { isRecognizedBankDomain } from "@/imports/email/email-sender-normalizer";

const INITIAL_SCAN_WINDOW_DAYS = 2;

async function processMessageIds(
  integration: GmailIntegration,
  client: GmailClient,
  messageIds: string[]
): Promise<number> {
  let transactionsProcessed = 0;

  for (const messageId of messageIds) {
    // Cheap pre-check before fetching the full message body over the
    // network — a re-delivered push notification or an overlapping
    // history window will often have already-seen IDs.
    const alreadyImported = await db.importedTransaction.findUnique({
      where: { externalMessageId: messageId },
      select: { id: true },
    });
    if (alreadyImported) continue;

    // Cheap header-only check before ever fetching a full body — an email
    // that isn't from a recognized UAE bank domain is skipped entirely
    // here: never fetched in full, never parsed, never written to the
    // database (not even as a "failed" record). Only known bank senders
    // ever have their content touched.
    const fromHeader = await client.fetchFromHeader(messageId);
    if (!fromHeader || !isRecognizedBankDomain(fromHeader)) continue;

    const message = await client.fetchMessage(messageId);
    if (!message) continue;

    await importService.processEmail(integration.userId, {
      fromAddress: message.fromAddress,
      subject: message.subject,
      body: message.body,
      receivedAt: message.internalDate,
      externalMessageId: message.id,
    });
    transactionsProcessed++;
  }

  return transactionsProcessed;
}

/**
 * Syncs one Gmail integration: fetches new messages since the last known
 * History API cursor (falling back to a bounded recent-messages scan on
 * first sync or an expired cursor), and runs each through
 * importService.processEmail(). Shared by the push-notification webhook
 * (the normal trigger) and the OAuth callback's initial sync right after
 * connecting, so a user sees results immediately rather than waiting for
 * the first push.
 */
export async function syncGmailIntegration(
  integration: GmailIntegration
): Promise<{ transactionsProcessed: number }> {
  const refreshToken = await gmailIntegrationService.getDecryptedRefreshToken(integration);
  const client = new GmailClient(refreshToken);

  let messageIds: string[];
  let newHistoryId: string;

  if (integration.lastHistoryId) {
    const result = await client.listNewMessageIdsSince(integration.lastHistoryId);
    if (result.expired) {
      messageIds = await client.listRecentMessageIds(INITIAL_SCAN_WINDOW_DAYS);
      newHistoryId = await client.getCurrentHistoryId();
    } else {
      messageIds = result.messageIds;
      newHistoryId = result.newHistoryId;
    }
  } else {
    messageIds = await client.listRecentMessageIds(INITIAL_SCAN_WINDOW_DAYS);
    newHistoryId = await client.getCurrentHistoryId();
  }

  const transactionsProcessed = await processMessageIds(integration, client, messageIds);
  await gmailIntegrationService.markSynced(integration.userId, newHistoryId);

  return { transactionsProcessed };
}

/**
 * Manually re-scans the last `windowDays` of inbox messages, bypassing the
 * History API cursor entirely. A normal push notification only fires once,
 * the moment an email first arrives — if that email failed because no
 * parser understood its format yet, adding a parser later doesn't get a
 * second chance at that same message through the normal sync path (its
 * historyId has already been passed). This is that second chance: it goes
 * through the exact same domain-allowlist gate and processEmail() pipeline
 * as the normal sync, so a message already successfully imported is
 * skipped (externalMessageId dedup) and nothing bypasses the bank-domain
 * filter — it just widens which messages are looked at.
 */
export async function resyncGmailIntegration(
  integration: GmailIntegration,
  windowDays: number
): Promise<{ transactionsProcessed: number }> {
  const refreshToken = await gmailIntegrationService.getDecryptedRefreshToken(integration);
  const client = new GmailClient(refreshToken);

  const messageIds = await client.listRecentMessageIds(windowDays);
  const transactionsProcessed = await processMessageIds(integration, client, messageIds);

  const newHistoryId = await client.getCurrentHistoryId();
  await gmailIntegrationService.markSynced(integration.userId, newHistoryId);

  return { transactionsProcessed };
}
