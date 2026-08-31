/**
 * POST /api/settings/gmail-link/resync
 *
 * Manual re-scan of every message ever received from a recognized bank
 * domain (ENBD, Mashreq), bypassing the Gmail History API cursor. Needed
 * when a parser is added *after* an email already arrived and failed with
 * "recognized bank, unsupported format" — a normal push notification only
 * fires once, at arrival, so that message never gets a second pass through
 * the pipeline on its own once support for its format ships. Gmail's own
 * search filters by sender server-side, and each match still runs through
 * the exact same domain-allowlist + processEmail() pipeline as the normal
 * sync/push path.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { gmailIntegrationService } from "@/server/services/gmail-integration.service";
import { resyncGmailIntegration } from "@/lib/gmail/sync-integration";

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await gmailIntegrationService.getActiveIntegration(session.user.id);
  if (!integration) {
    return NextResponse.json({ error: "Gmail is not connected." }, { status: 409 });
  }

  try {
    const { transactionsProcessed } = await resyncGmailIntegration(integration);
    return NextResponse.json({ data: { transactionsProcessed } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resync failed";
    await gmailIntegrationService.markError(session.user.id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
