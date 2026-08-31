/**
 * GET  /api/accounts/transfer-repair — diagnose internal transfers missing
 *      accountId/toAccountId (see transfer-repair.service.ts for why).
 *      Read-only, changes nothing.
 * POST /api/accounts/transfer-repair — repairs the transactionIds passed in
 *      the body. Only ever acts on ids the caller explicitly names, and
 *      only on that same user's own data.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { transferRepairService } from "@/server/services/transfer-repair.service";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const candidates = await transferRepairService.diagnose(session.user.id);
  return NextResponse.json({ data: candidates });
}

const RepairRequestSchema = z.object({
  transactionIds: z.array(z.string().min(1)).min(1).max(200),
});

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RepairRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "transactionIds must be a non-empty array of strings." }, { status: 400 });
  }

  const result = await transferRepairService.repair(session.user.id, parsed.data.transactionIds);
  return NextResponse.json({ data: result });
}
