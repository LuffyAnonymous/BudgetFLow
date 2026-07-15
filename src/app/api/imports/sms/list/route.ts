/**
 * GET /api/imports/sms
 *
 * List ImportedTransaction records for the authenticated user.
 * Excludes redactedPayload from list responses.
 *
 * Query params:
 *   status  - filter by ImportStatus
 *   page    - page number (default 1)
 *   pageSize - items per page (default 10, max 50)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { ImportStatus } from "@prisma/client";
import { z } from "zod";

const QuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = req.nextUrl;
  const parsed = QuerySchema.safeParse({
    status: searchParams.get("status") ?? undefined,
    page: searchParams.get("page") ?? 1,
    pageSize: searchParams.get("pageSize") ?? 10,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { status, page, pageSize } = parsed.data;

  const statuses = status ? status.split(",").map(s => s.trim()) as ImportStatus[] : undefined;

  const where = {
    userId,
    ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
  };

  const [totalItems, items] = await Promise.all([
    db.importedTransaction.count({ where }),
    db.importedTransaction.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        source: true,
        institution: true,
        status: true,
        confidence: true,
        parserKey: true,
        parsedAmount: true,
        parsedCurrency: true,
        parsedReference: true,
        parsedDescription: true,
        receivedAt: true,
        financialDate: true,
        processedAt: true,
        reviewedAt: true,
        duplicateCount: true,
        lastDuplicateAt: true,
        failureCode: true,
        failureMessage: true,
        transactionId: true,
        // redactedPayload intentionally excluded from list responses
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    data: {
      items,
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize) || 1,
    },
  });
}
