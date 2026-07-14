import { auth } from "@/auth";
import { TransactionService } from "@/server/services/transaction.service";
import { transactionFormSchema } from "@/features/transactions/schemas/transaction.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { Decimal } from "decimal.js";

const transactionService = new TransactionService();

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in.", 401);
    }

    const { id } = await params;
    const body = await request.json();
    
    // Validate with partial schema since updates can be partial
    const validationResult = transactionFormSchema.partial().safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const updateData: import("@/features/transactions/types/transaction.types").UpdateTransactionData = {};
    if (valData.date) updateData.date = valData.date;
    if (valData.categoryId) updateData.categoryId = valData.categoryId;
    if (valData.description) updateData.description = valData.description;
    if (valData.amount) updateData.amount = new Decimal(valData.amount);
    if (valData.paymentMethod) updateData.paymentMethod = valData.paymentMethod;
    if (valData.notes !== undefined) updateData.notes = valData.notes;
    if (valData.type) updateData.type = valData.type;

    const transaction = await transactionService.updateTransaction(id, session.user.id, updateData);

    // If this is an imported transaction, stamp adjustedAt to preserve import provenance
    const extendedTx = transaction as typeof transaction & { importSource?: string | null; adjustedAt?: Date | null };
    if (extendedTx.importSource && !extendedTx.adjustedAt) {
      const { db } = await import("@/lib/db");
      await db.transaction.update({
        where: { id },
        data: { adjustedAt: new Date() },
      });
    }

    return apiSuccess({
      id: transaction.id,
      date: transaction.date.toISOString(),
      categoryId: transaction.categoryId,
      description: transaction.description,
      amount: transaction.amount.toFixed(2),
      paymentMethod: transaction.paymentMethod,
      notes: transaction.notes,
      type: transaction.type,
      importSource: extendedTx.importSource ?? null,
      adjustedAt: extendedTx.adjustedAt?.toISOString() ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in.", 401);
    }

    const { id } = await params;
    await transactionService.deleteTransaction(id, session.user.id);

    return apiSuccess({ message: "Transaction deleted successfully." });
  } catch (error) {
    return handleApiError(error);
  }
}
