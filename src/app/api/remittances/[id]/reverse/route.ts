import { auth } from "@/auth";
import { RemittanceService } from "@/server/services/remittance.service";
import { reverseRemittanceSchema } from "@/features/remittances/schemas/remittance.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const remittanceService = new RemittanceService();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to reverse a remittance.", 401);
    }

    const { id } = await params;
    const body = await request.json();

    const validationResult = reverseRemittanceSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const { reversalReason, reversalIdempotencyKey, expectedVersion } = validationResult.data;

    const reversed = await remittanceService.reverseRemittance(id, session.user.id, {
      reversalReason,
      reversalIdempotencyKey: reversalIdempotencyKey || null,
      expectedVersion,
    });

    const r = reversed as typeof reversed & { category?: { name: string } | null };

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
      reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
      reversalReason: r.reversalReason,
      transactionId: r.transactionId,
      reversalTransactionId: r.reversalTransactionId,
      categoryId: r.categoryId,
      categoryName: r.category?.name || null,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
