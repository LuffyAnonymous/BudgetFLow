/**
 * POST /api/settings/reset-all-data
 *
 * Permanently deletes every transaction, debt payment, saving transaction,
 * remittance, imported-transaction record, and attachment for the current
 * user, and resets every account/debt/saving-goal balance back to its
 * starting state. Account/category/debt/goal *setup* is untouched.
 *
 * Requires the exact confirmation phrase in the body — checked server-side,
 * not just gated by a client-side confirm dialog, since this is the most
 * destructive single action in the app and a client-only guard is trivial
 * to bypass or misclick past.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { dataResetService } from "@/server/services/data-reset.service";

export const CONFIRMATION_PHRASE = "DELETE EVERYTHING";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== CONFIRMATION_PHRASE) {
    return NextResponse.json(
      { error: `Confirmation phrase didn't match. Type exactly: ${CONFIRMATION_PHRASE}` },
      { status: 400 }
    );
  }

  const summary = await dataResetService.resetAllFinancialData(session.user.id);
  return NextResponse.json({ data: summary });
}
