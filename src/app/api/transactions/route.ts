import { auth } from "@/auth";
import { TransactionService } from "@/server/services/transaction.service";
import { transactionFormSchema } from "@/features/transactions/schemas/transaction.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { Decimal } from "decimal.js";
import { TransactionType } from "@prisma/client";

const transactionService = new TransactionService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view transactions.", 401);
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const categoryId = searchParams.get("categoryId") || undefined;
    
    let type: TransactionType | undefined = undefined;
    const rawType = searchParams.get("type");
    if (rawType === "INCOME" || rawType === "EXPENSE") {
      type = rawType as TransactionType;
    }

    const startDateStr = searchParams.get("startDate");
    const endDateStr = searchParams.get("endDate");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "10", 10);

    const startDate = startDateStr ? new Date(startDateStr) : undefined;
    const endDate = endDateStr ? new Date(endDateStr) : undefined;

    const result = await transactionService.getTransactions(session.user.id, {
      search,
      categoryId,
      type,
      startDate,
      endDate,
      page,
      pageSize,
    });

    // Map amounts as strings for clean serialization
    const serializedItems = result.items.map((tx) => {
      const extendedTx = tx as typeof tx & { category?: { name: string; type: string } | null };
      return {
        id: extendedTx.id,
        date: extendedTx.date.toISOString(),
        budgetMonth: (extendedTx as Record<string, unknown>).budgetMonth as string | null ?? null,
        categoryId: extendedTx.categoryId,
        categoryName: extendedTx.category?.name || "Unknown",
        categoryType: extendedTx.category?.type || "EXPENSE",
        description: extendedTx.description,
        amount: extendedTx.amount.toFixed(2),
        paymentMethod: extendedTx.paymentMethod,
        notes: extendedTx.notes,
        type: extendedTx.type,
        importSource: (extendedTx as Record<string, unknown>).importSource as string | null ?? null,
        adjustedAt: (extendedTx as Record<string, unknown>).adjustedAt instanceof Date
          ? ((extendedTx as Record<string, unknown>).adjustedAt as Date).toISOString()
          : null,
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
      return apiError("UNAUTHORIZED", "You must be signed in to create a transaction.", 401);
    }

    const body = await request.json();
    const validationResult = transactionFormSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const transaction = await transactionService.createTransaction(session.user.id, {
      date: valData.date,
      budgetMonth: valData.budgetMonth,
      categoryId: valData.categoryId,
      description: valData.description,
      amount: new Decimal(valData.amount),
      paymentMethod: valData.paymentMethod,
      notes: valData.notes || null,
      type: valData.type,
    });

    return apiSuccess({
      id: transaction.id,
      date: transaction.date.toISOString(),
      budgetMonth: (transaction as Record<string, unknown>).budgetMonth as string | null ?? null,
      categoryId: transaction.categoryId,
      description: transaction.description,
      amount: transaction.amount.toFixed(2),
      paymentMethod: transaction.paymentMethod,
      notes: transaction.notes,
      type: transaction.type,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
