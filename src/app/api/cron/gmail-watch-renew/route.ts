/**
 * GET /api/cron/gmail-watch-renew
 *
 * Renews every ACTIVE Gmail integration's push-notification subscription
 * before it lapses. Google caps a Gmail watch() at 7 days no matter what —
 * this is not optional bookkeeping, it's the only thing standing between
 * "push notifications keep working" and "silently stops importing."
 *
 * Triggered by a weekly GitHub Actions workflow (.github/workflows/
 * gmail-watch-renew.yml), same Bearer $CRON_SECRET pattern as
 * /api/cron/health — this app has no n8n-triggered scheduling for the
 * Gmail feature at all, unlike the SMS/health-check jobs.
 *
 * Renews anything expiring within 48h (not exactly at the 7-day mark) so
 * a slightly-late weekly run still has margin before the hard cutoff.
 */

import { NextRequest, NextResponse } from "next/server";
import { NotificationType, NotificationSeverity } from "@prisma/client";
import { NotificationService } from "@/server/services/notification.service";
import { gmailIntegrationService } from "@/server/services/gmail-integration.service";
import { GmailClient } from "@/lib/gmail/gmail-client";

const RENEWAL_WINDOW_HOURS = 48;

const notificationService = new NotificationService();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topicName) {
    return NextResponse.json({ error: "GOOGLE_PUBSUB_TOPIC is not configured" }, { status: 500 });
  }

  const integrations = await gmailIntegrationService.listIntegrationsNeedingWatchRenewal(RENEWAL_WINDOW_HOURS);

  let renewed = 0;
  let errored = 0;

  for (const integration of integrations) {
    try {
      const refreshToken = await gmailIntegrationService.getDecryptedRefreshToken(integration);
      const client = new GmailClient(refreshToken);
      const { historyId, expiration } = await client.watch(topicName);
      await gmailIntegrationService.saveWatch(integration.userId, { historyId, expiration });
      renewed++;
    } catch (err) {
      errored++;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Gmail Watch Renew] Failed for user", integration.userId, message);

      await gmailIntegrationService.markError(integration.userId, message);
      await notificationService.createNotificationIdempotent(integration.userId, {
        type: NotificationType.GMAIL_CONNECTION_ERROR,
        title: "Gmail connection needs attention",
        message: "Couldn't renew the Gmail import subscription — reconnect Gmail in Settings to resume.",
        severity: NotificationSeverity.WARNING,
        eventKey: `gmail-watch-renew-error-${integration.userId}-${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  return NextResponse.json({ success: true, checked: integrations.length, renewed, errored });
}
