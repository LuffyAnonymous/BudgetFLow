/**
 * POST /api/settings/gmail-link/resync
 *
 * Manual re-scan of the last N days (default 7, 1-30 accepted via an
 * optional `{ days }` body) of mail from a recognized bank domain (ENBD,
 * Mashreq), bypassing the Gmail History API cursor. Needed when a parser is
 * added *after* an email already arrived and failed with "recognized bank,
 * unsupported format" — a normal push notification only fires once, at
 * arrival, so that message never gets a second pass through the pipeline on
 * its own once support for its format ships. Gmail's own search filters by
 * both sender and date server-side, and each match still runs through the
 * exact same domain-allowlist + processEmail() pipeline as the normal
 * sync/push path.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { gmailIntegrationService } from "@/server/services/gmail-integration.service";
import {
  resyncGmailIntegration,
  DEFAULT_RESYNC_WINDOW_DAYS,
  MIN_RESYNC_WINDOW_DAYS,
  MAX_RESYNC_WINDOW_DAYS,
} from "@/lib/gmail/sync-integration";

const ResyncRequestSchema = z.object({
  days: z.number().int().min(MIN_RESYNC_WINDOW_DAYS).max(MAX_RESYNC_WINDOW_DAYS).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await gmailIntegrationService.getActiveIntegration(session.user.id);
  if (!integration) {
    return NextResponse.json({ error: "Gmail is not connected." }, { status: 409 });
  }

  // An empty body is the common case (default window) — only reject
  // malformed JSON when the caller actually sent a body to parse.
  let days = DEFAULT_RESYNC_WINDOW_DAYS;
  const rawBody = await request.text();
  if (rawBody) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = ResyncRequestSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        { error: `days must be a whole number between ${MIN_RESYNC_WINDOW_DAYS} and ${MAX_RESYNC_WINDOW_DAYS}.` },
        { status: 400 }
      );
    }
    days = parsed.data.days ?? DEFAULT_RESYNC_WINDOW_DAYS;
  }

  try {
    const { transactionsProcessed } = await resyncGmailIntegration(integration, days);
    return NextResponse.json({ data: { transactionsProcessed, days } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resync failed";
    await gmailIntegrationService.markError(session.user.id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
