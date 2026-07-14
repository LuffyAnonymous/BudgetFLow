import { auth } from "@/auth";
import { BudgetService } from "@/server/services/budget.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { z } from "zod";
import { parseCanonicalMonth } from "@/lib/dates";

const budgetService = new BudgetService();

const copyBudgetsSchema = z.object({
  sourceMonth: z.string().refine(
    (val) => {
      try {
        parseCanonicalMonth(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Source month must be in YYYY-MM format." }
  ),
  targetMonth: z.string().refine(
    (val) => {
      try {
        parseCanonicalMonth(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Target month must be in YYYY-MM format." }
  ),
}).refine(
  (data) => data.sourceMonth !== data.targetMonth,
  {
    message: "Source and target months must be different.",
    path: ["targetMonth"],
  }
);

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to copy budgets.", 401);
    }

    const body = await request.json();
    const validationResult = copyBudgetsSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const { sourceMonth, targetMonth } = validationResult.data;
    const result = await budgetService.copyPreviousMonthBudgets(
      session.user.id,
      sourceMonth,
      targetMonth
    );

    return apiSuccess({
      message: `Successfully copied ${result.copiedCount} budgets.`,
      copiedCount: result.copiedCount,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
