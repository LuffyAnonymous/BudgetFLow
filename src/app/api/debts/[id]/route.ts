import { auth } from "@/auth";
import { DebtService } from "@/server/services/debt.service";
import { updateDebtSchema } from "@/features/debts/schemas/debt.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const debtService = new DebtService();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view debt details.", 401);
    }

    const { id } = await params;
    const debt = await debtService.getDebtById(id, session.user.id);
    
    // Also fetch the payoff projection
    const projection = await debtService.getPayoffProjection(id, session.user.id);

    const d = debt as typeof debt & { category?: { name: string } | null };
    return apiSuccess({
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
      payeeAliases: d.payeeAliases,
      version: d.version,
      createdAt: d.createdAt.toISOString(),
      projection,
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
      return apiError("UNAUTHORIZED", "You must be signed in to update a debt.", 401);
    }

    const { id } = await params;
    const body = await request.json();
    const validationResult = updateDebtSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const updatedDebt = await debtService.updateDebt(id, session.user.id, valData);

    return apiSuccess({
      id: updatedDebt.id,
      name: updatedDebt.name,
      originalBalance: updatedDebt.originalBalance.toFixed(2),
      currentBalance: updatedDebt.currentBalance.toFixed(2),
      monthlyPayment: updatedDebt.monthlyPayment.toFixed(2),
      dueDay: updatedDebt.dueDay,
      rolloverFeeRate: updatedDebt.rolloverFeeRate.toFixed(4),
      status: updatedDebt.status,
      notes: updatedDebt.notes,
      categoryId: updatedDebt.categoryId,
      payeeAliases: updatedDebt.payeeAliases,
      version: updatedDebt.version,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
