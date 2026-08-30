/**
 * POST /api/webhooks/gmail-push?secret=<GMAIL_PUSH_WEBHOOK_SECRET>
 *
 * Receives Gmail push notifications via Google Cloud Pub/Sub — this is the
 * actual real-time trigger for email import (not a polling loop). Google
 * Cloud Pub/Sub is configured (outside this codebase, in Google Cloud
 * Console) with a push subscription pointing at this URL; see
 * docs/gmail-bank-email-import.md for the exact setup steps.
 *
 * Auth: the webhook secret is embedded in the subscription's configured
 * endpoint URL (the same shared-secret-in-URL pattern this app already
 * uses for other machine-to-machine callers, just as a query param since
 * Pub/Sub push doesn't let us set a custom Authorization header from the
 * console UI) rather than verifying Google's optional OIDC token — simpler
 * and consistent with CRON_SECRET/IMPORT_CLEANUP_SECRET elsewhere in this
 * app, at the cost of being slightly less defense-in-depth than OIDC
 * verification would be.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { NotificationType, NotificationSeverity } from "@prisma/client";
import { NotificationService } from "@/server/services/notification.service";
import { gmailIntegrationService } from "@/server/services/gmail-integration.service";
import { syncGmailIntegration } from "@/lib/gmail/sync-integration";

const notificationService = new NotificationService();

interface PubSubPushBody {
  message?: { data?: string };
  subscription?: string;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.GMAIL_PUSH_WEBHOOK_SECRET ?? "";
  const providedSecret = req.nextUrl.searchParams.get("secret") ?? "";
  if (!expectedSecret || !safeCompare(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PubSubPushBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const encodedData = body.message?.data;
  if (!encodedData) {
    // Pub/Sub retries on non-2xx — a malformed message isn't something a
    // retry would fix, so ack it (200) rather than trigger a retry storm.
    console.warn("[Gmail Push] Received push with no message.data");
    return NextResponse.json({ ok: true });
  }

  let emailAddress: string | undefined;
  try {
    const decoded = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8")) as {
      emailAddress?: string;
      historyId?: string | number;
    };
    emailAddress = decoded.emailAddress;
  } catch {
    console.warn("[Gmail Push] Failed to decode/parse message.data");
    return NextResponse.json({ ok: true });
  }

  if (!emailAddress) {
    return NextResponse.json({ ok: true });
  }

  const integration = await gmailIntegrationService.getByGoogleAccountEmail(emailAddress);
  if (!integration) {
    // Not necessarily an error — could be a notification for an account
    // that was since disconnected. Ack it either way; nothing to retry.
    console.warn("[Gmail Push] No active integration for", emailAddress);
    return NextResponse.json({ ok: true });
  }

  try {
    const { transactionsProcessed } = await syncGmailIntegration(integration);
    return NextResponse.json({ ok: true, transactionsProcessed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Gmail Push] Sync failed for", emailAddress, message);
    await gmailIntegrationService.markError(integration.userId, message);
    await notificationService.createNotificationIdempotent(integration.userId, {
      type: NotificationType.GMAIL_CONNECTION_ERROR,
      title: "Gmail connection needs attention",
      message: "Bank email import stopped working — reconnect Gmail in Settings to resume.",
      severity: NotificationSeverity.WARNING,
      // Dedup per calendar day so a persistently broken connection doesn't
      // spam a fresh notification on every push delivery.
      eventKey: `gmail-connection-error-${integration.userId}-${new Date().toISOString().slice(0, 10)}`,
    });
    // Still ack (200) — Pub/Sub retrying won't fix an auth/revocation
    // error, and the notification above already tells the user. Returning
    // 500 here would just retry-storm the same failure.
    return NextResponse.json({ ok: false, error: message });
  }
}
