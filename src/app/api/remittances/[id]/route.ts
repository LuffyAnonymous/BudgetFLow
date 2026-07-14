import { auth } from "@/auth";
import { RemittanceService } from "@/server/services/remittance.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const remittanceService = new RemittanceService();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view remittance details.", 401);
    }

    const { id } = await params;
    const remittance = await remittanceService.getRemittanceById(id, session.user.id);

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to modify a remittance.", 401);
    }

    const { id } = await params;
    const body = await request.json();

    if (body.archive === undefined) {
      return apiError("BAD_REQUEST", "Missing archive parameter.", 400);
    }

    let updated;
    if (body.archive) {
      updated = await remittanceService.archiveRemittance(id, session.user.id);
    } else {
      updated = await remittanceService.unarchiveRemittance(id, session.user.id);
    }

    const r = updated as typeof updated & { category?: { name: string } | null };

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
      version: r.version,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
