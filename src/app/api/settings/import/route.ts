/**
 * POST /api/settings/import
 * PATCH /api/settings/import
 *
 * Configure import settings for the authenticated user.
 *
 * Request body (all fields optional):
 *   {
 *     "enabled":          boolean
 *     "senderAllowlist":  string[]
 *     "salaryCategoryId": string | null
 *     "expectedCurrency": string
 *     "minimumAmount":    number | null
 *     "maximumAmount":    number | null
 *     "rawPayloadRetentionDays": number
 *   }
 *
 * Auto-posting for confident matches (HIGH/MEDIUM score from the confidence
 * engine) happens automatically whenever import is enabled — there is no
 * separate opt-in switch for it.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { importSettingService } from "@/server/services/import-setting.service";
import { z } from "zod";

const ImportSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  senderAllowlist: z.array(z.string().min(1).max(100)).optional(),
  salaryCategoryId: z.string().uuid().nullish(),
  expectedCurrency: z.string().min(1).max(10).optional(),
  minimumAmount: z.number().positive().nullish(),
  maximumAmount: z.number().positive().nullish(),
  rawPayloadRetentionDays: z.number().int().min(1).max(3650).optional(),
});

async function handleUpdate(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ImportSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const updated = await importSettingService.update(userId, parsed.data);
    return NextResponse.json({ data: { ok: true, enabled: updated.enabled } });
  } catch (err: unknown) {
    console.error("[settings/import] Update failed:", err);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = await importSettingService.getOrCreate(session.user.id);
  return NextResponse.json({ data: settings });
}

export const POST = handleUpdate;
export const PATCH = handleUpdate;
