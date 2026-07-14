/**
 * GET /api/settings/import-token/status
 *
 * Returns token metadata only — never the hash or plaintext.
 * Includes expiresAt, lastUsedAt, isExpired for UI display.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { importSettingService } from "@/server/services/import-setting.service";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await importSettingService.getTokenStatus(session.user.id);
  return NextResponse.json({ data: status });
}
