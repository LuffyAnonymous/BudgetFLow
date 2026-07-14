import { auth } from "@/auth";
import { DebtService } from "@/server/services/debt.service";
import { createDebtSchema } from "@/features/debts/schemas/debt.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { DebtStatus } from "@prisma/client";

const debtService = new DebtService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view debts.", 401);
    }

    const { searchParams } = new URL(request.url);
    const rawStatus = searchParams.get("status");
    let statusFilter: DebtStatus | undefined = undefined;

    if (rawStatus === "ACTIVE" || rawStatus === "PAID" || rawStatus === "ARCHIVED" || rawStatus === "PAUSED") {
      statusFilter = rawStatus as DebtStatus;
    }

    const items = await debtService.getDebts(session.user.id, statusFilter);

    const serializedItems = items.map((debt) => {
      const d = debt as typeof debt & { category?: { name: string } | null };
      return {
        id: d.id,
        name: d.name,
        originalBalance: d.originalBalance.toFixed(2),
        currentBalance: d.currentBalance.toFixed(2),
        monthlyPayment: d.monthlyPayment.toFixed(2),
        dueDay: d.dueDay,
        rolloverFeeRate: d.rolloverFeeRate.toFixed(4),
        status: d.status,
        notes: d.notes,
        categoryId: d.categoryId,
        categoryName: d.category?.name || null,
        version: d.version,
        createdAt: d.createdAt.toISOString(),
      };
    });

    return apiSuccess(serializedItems);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to create a debt.", 401);
    }

    const body = await request.json();
    const validationResult = createDebtSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const debt = await debtService.createDebt(session.user.id, valData);

    return apiSuccess({
      id: debt.id,
      name: debt.name,
      originalBalance: debt.originalBalance.toFixed(2),
      currentBalance: debt.currentBalance.toFixed(2),
      monthlyPayment: debt.monthlyPayment.toFixed(2),
      dueDay: debt.dueDay,
      rolloverFeeRate: debt.rolloverFeeRate.toFixed(4),
      status: debt.status,
      notes: debt.notes,
      categoryId: debt.categoryId,
      version: debt.version,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
