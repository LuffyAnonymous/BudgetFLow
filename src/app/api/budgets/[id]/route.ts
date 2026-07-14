import { auth } from "@/auth";
import { BudgetService } from "@/server/services/budget.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const budgetService = new BudgetService();

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
    await budgetService.deleteBudget(id, session.user.id);

    return apiSuccess({ message: "Budget plan deleted successfully." });
  } catch (error) {
    return handleApiError(error);
  }
}
