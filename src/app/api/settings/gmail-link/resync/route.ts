/**
 * POST /api/settings/gmail-link/resync?days=7
 *
 * Manual re-scan of recent inbox messages, bypassing the Gmail History API
 * cursor. Needed when a parser is added *after* an email already arrived
 * and failed with "recognized bank, unsupported format" — a normal push
 * notification only fires once, at arrival, so that message never gets a
 * second pass through the pipeline on its own once support for its format
 * ships. This re-runs the exact same domain-allowlist + processEmail()
 * pipeline as the normal sync/push path over a wider recent window.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { gmailIntegrationService } from "@/server/services/gmail-integration.service";
import { resyncGmailIntegration } from "@/lib/gmail/sync-integration";

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 14;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await gmailIntegrationService.getActiveIntegration(session.user.id);
  if (!integration) {
    return NextResponse.json({ error: "Gmail is not connected." }, { status: 409 });
  }

  const daysParam = req.nextUrl.searchParams.get("days");
  const parsedDays = daysParam ? parseInt(daysParam, 10) : DEFAULT_WINDOW_DAYS;
  const windowDays =
    Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;

  try {
    const { transactionsProcessed } = await resyncGmailIntegration(integration, windowDays);
    return NextResponse.json({ data: { transactionsProcessed } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resync failed";
    await gmailIntegrationService.markError(session.user.id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
