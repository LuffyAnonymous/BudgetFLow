import { auth } from "@/auth";
import { SavingService } from "@/server/services/saving.service";
import { createSavingGoalSchema } from "@/features/savings/schemas/saving.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { SavingGoalStatus } from "@prisma/client";

const savingService = new SavingService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view savings goals.", 401);
    }

    const { searchParams } = new URL(request.url);
    const rawStatus = searchParams.get("status");
    let statusFilter: SavingGoalStatus | undefined = undefined;

    if (rawStatus === "ACTIVE" || rawStatus === "COMPLETED" || rawStatus === "ARCHIVED" || rawStatus === "PAUSED") {
      statusFilter = rawStatus as SavingGoalStatus;
    }

    const items = await savingService.getSavingGoals(session.user.id, statusFilter);

    const serializedItems = items.map((goal) => {
      const g = goal as typeof goal & { category?: { name: string } | null };
      return {
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
      return apiError("UNAUTHORIZED", "You must be signed in to create a savings goal.", 401);
    }

    const body = await request.json();
    const validationResult = createSavingGoalSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const goal = await savingService.createSavingGoal(session.user.id, valData);

    return apiSuccess({
      id: goal.id,
      name: goal.name,
      targetAmount: goal.targetAmount.toFixed(2),
      currentAmount: goal.currentAmount.toFixed(2),
      targetDate: goal.targetDate ? goal.targetDate.toISOString() : null,
      status: goal.status,
      notes: goal.notes,
      categoryId: goal.categoryId,
      version: goal.version,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
