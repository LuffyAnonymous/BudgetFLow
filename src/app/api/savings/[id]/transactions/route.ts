import { auth } from "@/auth";
import { SavingService } from "@/server/services/saving.service";
import { recordSavingTransactionSchema } from "@/features/savings/schemas/saving.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const savingService = new SavingService();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view savings transactions.", 401);
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "10", 10);

    const result = await savingService.getTransactions(session.user.id, {
      savingGoalId: id,
      page,
      pageSize,
    });

    const serializedItems = result.items.map((tx) => ({
      id: tx.id,
      savingGoalId: tx.savingGoalId,
      amount: tx.amount.toFixed(2),
      balanceBefore: tx.balanceBefore.toFixed(2),
      balanceAfter: tx.balanceAfter.toFixed(2),
      type: tx.type,
      transactionDate: tx.transactionDate.toISOString(),
      notes: tx.notes,
      transactionId: tx.transactionId,
      transactionStatus: tx.transactionId ? "LINKED" : "UNLINKED",
      createdAt: tx.createdAt.toISOString(),
    }));

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to record a savings transaction.", 401);
    }

    const { id } = await params;
    const body = await request.json();
    const validationResult = recordSavingTransactionSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const tx = await savingService.recordSavingTransaction(session.user.id, id, valData);

    return apiSuccess({
      id: tx.id,
      savingGoalId: tx.savingGoalId,
      amount: tx.amount.toFixed(2),
      balanceBefore: tx.balanceBefore.toFixed(2),
      balanceAfter: tx.balanceAfter.toFixed(2),
      type: tx.type,
      transactionDate: tx.transactionDate.toISOString(),
      notes: tx.notes,
      transactionId: tx.transactionId,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
