/**
 * POST /api/settings/import
 * PATCH /api/settings/import
 *
 * Configure import settings for the authenticated user.
 *
 * Request body (all fields optional):
 *   {
 *     "enabled":          boolean
 *     "autoImportSalary": boolean   — requires preconditions (Check #10)
 *     "senderAllowlist":  string[]
 *     "salaryCategoryId": string | null
 *     "expectedCurrency": string
 *     "minimumAmount":    number | null
 *     "maximumAmount":    number | null
 *     "rawPayloadRetentionDays": number
 *     "amountBoundsWaived": boolean — allows enabling auto-import without amount bounds
 *   }
 *
 * If autoImportSalary=true is requested and preconditions are not met,
 * returns 422 with code "AUTO_IMPORT_PRECONDITIONS_NOT_MET".
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { importSettingService } from "@/server/services/import-setting.service";
import { z } from "zod";

const ImportSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  autoImportSalary: z.boolean().optional(),
  senderAllowlist: z.array(z.string().min(1).max(100)).optional(),
  salaryCategoryId: z.string().uuid().nullish(),
  expectedCurrency: z.string().min(1).max(10).optional(),
  minimumAmount: z.number().positive().nullish(),
  maximumAmount: z.number().positive().nullish(),
  rawPayloadRetentionDays: z.number().int().min(1).max(3650).optional(),
  amountBoundsWaived: z.boolean().optional(),
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
    const e = err as Error & { code?: string };
    if (e.code === "AUTO_IMPORT_PRECONDITIONS_NOT_MET") {
      return NextResponse.json(
        {
          error: e.message,
          code: e.code,
        },
        { status: 422 }
      );
    }
    console.error("[settings/import] Update failed:", err);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

export const POST = handleUpdate;
export const PATCH = handleUpdate;
