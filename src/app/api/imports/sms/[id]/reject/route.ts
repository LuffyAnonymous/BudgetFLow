/**
 * POST /api/imports/sms/[id]/reject
 *
 * Permanently rejects a REVIEW_REQUIRED import.
 * A rejected import cannot later be confirmed.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { importService } from "@/imports/engine/import.service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  try {
    await importService.rejectImport(userId, id);
    return NextResponse.json({ data: { rejected: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status =
      message === "IMPORT_NOT_FOUND" ? 404
      : message === "IMPORT_NOT_OWNED" ? 404
      : message.startsWith("IMPORT_CANNOT_REJECT") ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
