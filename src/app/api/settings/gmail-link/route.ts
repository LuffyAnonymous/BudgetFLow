/**
 * GET    /api/settings/gmail-link  — is Gmail currently connected, and to which account?
 * DELETE /api/settings/gmail-link  — disconnect the connected Gmail account
 *
 * Connecting itself is a redirect flow, not a POST here — see
 * GET /api/settings/gmail-link/authorize (starts it) and
 * GET /api/integrations/gmail/callback (completes it).
 *
 * All routes require an Auth.js session.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { gmailIntegrationService } from "@/server/services/gmail-integration.service";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await gmailIntegrationService.getStatus(session.user.id);
  return NextResponse.json({ data: status });
}

export async function DELETE(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await gmailIntegrationService.disconnect(session.user.id);
  return NextResponse.json({ data: { disconnected: true } });
}
