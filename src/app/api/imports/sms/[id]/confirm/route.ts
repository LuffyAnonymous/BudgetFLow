/**
 * POST /api/imports/sms/[id]/confirm
 *
 * Confirms a REVIEW_REQUIRED import — atomically creates the ledger transaction.
 *
 * Optional body:
 *   {
 *     "categoryId":    string (override configured salaryCategoryId)
 *     "financialDate": string (ISO date string, override parsed date)
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { importService } from "@/imports/engine/import.service";
import { z } from "zod";

const ConfirmBodySchema = z.object({
  categoryId: z.string().uuid().optional(),
  financialDate: z.string().datetime({ offset: true }).optional(),
}).optional();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  let overrides: { categoryId?: string; financialDate?: Date } | undefined;
  try {
    const body = await req.json().catch(() => undefined);
    const parsed = ConfirmBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (parsed.data) {
      overrides = {
        categoryId: parsed.data.categoryId,
        financialDate: parsed.data.financialDate
          ? new Date(parsed.data.financialDate)
          : undefined,
      };
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await importService.confirmImport(userId, id, overrides);
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status =
      message === "IMPORT_NOT_FOUND" ? 404
      : message === "IMPORT_NOT_OWNED" ? 404
      : message.startsWith("IMPORT_CANNOT_CONFIRM") ? 409
      : message === "NO_SALARY_CATEGORY_CONFIGURED" ? 422
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
