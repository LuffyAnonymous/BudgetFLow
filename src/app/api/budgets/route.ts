import { auth } from "@/auth";
import { BudgetService } from "@/server/services/budget.service";
import { budgetFormSchema } from "@/features/budgets/schemas/budget.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { getDubaiCurrentDate } from "@/lib/dates";
import { Decimal } from "decimal.js";

const budgetService = new BudgetService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view budgets.", 401);
    }

    const { searchParams } = new URL(request.url);
    let month = searchParams.get("month");
    
    if (!month) {
      const { year, month: curMonth } = getDubaiCurrentDate();
      month = `${year}-${String(curMonth).padStart(2, "0")}`;
    }

    const budgetOverview = await budgetService.getBudgetOverview(session.user.id, month);
    return apiSuccess(budgetOverview);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to create a budget.", 401);
    }

    const body = await request.json();
    const validationResult = budgetFormSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const budget = await budgetService.upsertBudget(session.user.id, {
      categoryId: valData.categoryId,
      amount: new Decimal(valData.amount),
      month: valData.month,
    });

    return apiSuccess({
      id: budget.id,
      categoryId: budget.categoryId,
      amount: budget.amount.toFixed(2),
      month: budget.month,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
