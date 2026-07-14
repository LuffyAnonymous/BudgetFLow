import { auth } from "@/auth";
import { RecurringService } from "@/server/services/recurring.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const recurringService = new RecurringService();

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to run evaluation.", 401);
    }

    const counts = await recurringService.evaluateOccurrences(session.user.id);
    return apiSuccess({
      message: "Occurrences evaluated and auto-generated successfully.",
      ...counts,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
