import { auth } from "@/auth";
import { SavingService } from "@/server/services/saving.service";
import { updateSavingGoalSchema } from "@/features/savings/schemas/saving.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const savingService = new SavingService();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view savings goal details.", 401);
    }

    const { id } = await params;
    const goal = await savingService.getSavingGoalById(id, session.user.id);

    const g = goal as typeof goal & { category?: { name: string } | null };
    return apiSuccess({
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmount.toFixed(2),
      currentAmount: g.currentAmount.toFixed(2),
      targetDate: g.targetDate ? g.targetDate.toISOString() : null,
      status: g.status,
      notes: g.notes,
      categoryId: g.categoryId,
      categoryName: g.category?.name || null,
      version: g.version,
      createdAt: g.createdAt.toISOString(),
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
      return apiError("UNAUTHORIZED", "You must be signed in to update a savings goal.", 401);
    }

    const { id } = await params;
    const body = await request.json();
    const validationResult = updateSavingGoalSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const updatedGoal = await savingService.updateSavingGoal(id, session.user.id, valData);

    return apiSuccess({
      id: updatedGoal.id,
      name: updatedGoal.name,
      targetAmount: updatedGoal.targetAmount.toFixed(2),
      currentAmount: updatedGoal.currentAmount.toFixed(2),
      targetDate: updatedGoal.targetDate ? updatedGoal.targetDate.toISOString() : null,
      status: updatedGoal.status,
      notes: updatedGoal.notes,
      categoryId: updatedGoal.categoryId,
      version: updatedGoal.version,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
