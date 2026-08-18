/**
 * GET  /api/imports/sms/[id]       — fetch single import (includes redactedPayload for review)
 * POST /api/imports/sms/[id]/confirm  — handled in separate route file
 * POST /api/imports/sms/[id]/reject   — handled in separate route file
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const importedTx = await db.importedTransaction.findUnique({
    where: { id },
    select: {
      id: true,
      source: true,
      institution: true,
      status: true,
      confidence: true,
      parserKey: true,
      parserVersion: true,
      redactedPayload: true, // included only in detail view
      maskedSender: true,
      parsedAmount: true,
      parsedCurrency: true,
      parsedReference: true,
      parsedDescription: true,
      receivedAt: true,
      financialDate: true,
      processedAt: true,
      reviewedAt: true,
      duplicateCount: true,
      failureCode: true,
      failureMessage: true,
      transactionId: true,
      attachments: {
        where: { status: { not: "DELETED" } },
        select: { id: true, mimeType: true },
      },
      transaction: {
        select: {
          id: true,
          date: true,
          amount: true,
          description: true,
          type: true,
          importSource: true,
          adjustedAt: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!importedTx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Ownership check
  const owner = await db.importedTransaction.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owner) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ data: importedTx });
}
