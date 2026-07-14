import { auth } from "@/auth";
import { RemittanceService } from "@/server/services/remittance.service";
import { createRemittanceSchema } from "@/features/remittances/schemas/remittance.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { RemittanceStatus } from "@prisma/client";

const remittanceService = new RemittanceService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view remittances.", 401);
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") ?? "10", 10);
    const recipient = searchParams.get("recipient") || undefined;
    const transferProvider = searchParams.get("transferProvider") || undefined;
    const statusParam = searchParams.get("status");
    const includeArchived = searchParams.get("includeArchived") === "true";

    let status: RemittanceStatus | undefined = undefined;
    if (statusParam === "COMPLETED" || statusParam === "REVERSED") {
      status = statusParam as RemittanceStatus;
    }

    const startDateStr = searchParams.get("startDate");
    const endDateStr = searchParams.get("endDate");

    let startDate: Date | undefined = undefined;
    let endDate: Date | undefined = undefined;

    if (startDateStr) {
      startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) {
        return apiError("BAD_REQUEST", "Invalid startDate format", 400);
      }
    }
    if (endDateStr) {
      endDate = new Date(endDateStr);
      if (isNaN(endDate.getTime())) {
        return apiError("BAD_REQUEST", "Invalid endDate format", 400);
      }
    }

    const result = await remittanceService.getRemittances(session.user.id, {
      page,
      pageSize,
      startDate,
      endDate,
      recipient,
      transferProvider,
      status,
      includeArchived,
    });

    const serializedItems = result.items.map((remittance) => {
      const r = remittance as typeof remittance & { category?: { name: string } | null };
      return {
        id: r.id,
        recipient: r.recipient || null,
        amountSentAed: r.amountSentAed.toFixed(2),
        cashOutflowAed: r.cashOutflowAed.toFixed(2),
        exchangeRate: r.exchangeRate ? r.exchangeRate.toFixed(6) : null,
        amountReceivedPhp: r.amountReceivedPhp ? r.amountReceivedPhp.toFixed(2) : null,
        transferFeeAed: r.transferFeeAed ? r.transferFeeAed.toFixed(2) : null,
        transferProvider: r.transferProvider,
        transferDate: r.transferDate.toISOString(),
        referenceNumber: r.referenceNumber,
        notes: r.notes,
        status: r.status,
        archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
        reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
        reversalReason: r.reversalReason,
        transactionId: r.transactionId,
        reversalTransactionId: r.reversalTransactionId,
        categoryId: r.categoryId,
        categoryName: r.category?.name || null,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return apiSuccess({
      items: serializedItems,
      page: result.page,
      pageSize: result.pageSize,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to create a remittance.", 401);
    }

    const body = await request.json();
    const validationResult = createRemittanceSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const payload = validationResult.data;

    const remittance = await remittanceService.createRemittance(session.user.id, {
      recipient: payload.recipient,
      amountSentAed: payload.amountSentAed,
      exchangeRate: payload.exchangeRate,
      transferFeeAed: payload.transferFeeAed,
      transferProvider: payload.transferProvider,
      transferDate: new Date(payload.transferDate),
      referenceNumber: payload.referenceNumber,
      notes: payload.notes,
      categoryId: payload.categoryId,
      syncLedger: payload.syncLedger,
      idempotencyKey: payload.idempotencyKey,
    });

    const r = remittance as typeof remittance & { category?: { name: string } | null };

    return apiSuccess({
      id: r.id,
      recipient: r.recipient || null,
      amountSentAed: r.amountSentAed.toFixed(2),
      cashOutflowAed: r.cashOutflowAed.toFixed(2),
      exchangeRate: r.exchangeRate ? r.exchangeRate.toFixed(6) : null,
      amountReceivedPhp: r.amountReceivedPhp ? r.amountReceivedPhp.toFixed(2) : null,
      transferFeeAed: r.transferFeeAed ? r.transferFeeAed.toFixed(2) : null,
      transferProvider: r.transferProvider,
      transferDate: r.transferDate.toISOString(),
      referenceNumber: r.referenceNumber,
      notes: r.notes,
      status: r.status,
      archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      transactionId: r.transactionId,
      categoryId: r.categoryId,
      categoryName: r.category?.name || null,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
