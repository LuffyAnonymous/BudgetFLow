/**
 * POST   /api/settings/telegram-link  — generate a one-time linking code
 * GET    /api/settings/telegram-link  — is this account currently linked?
 * DELETE /api/settings/telegram-link  — unlink the connected Telegram chat
 *
 * All routes require an Auth.js session.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { importSettingService } from "@/server/services/import-setting.service";

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { code, expiresAt } = await importSettingService.generateTelegramLinkCode(session.user.id);
  return NextResponse.json({
    data: {
      code,
      expiresAt: expiresAt.toISOString(),
      instructions: `Message the bot "/link ${code}" within 10 minutes to connect this Telegram chat.`,
    },
  });
}

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await importSettingService.getTelegramLinkStatus(session.user.id);
  return NextResponse.json({ data: status });
}

export async function DELETE(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await importSettingService.unlinkTelegram(session.user.id);
  return NextResponse.json({ data: { unlinked: true } });
}
