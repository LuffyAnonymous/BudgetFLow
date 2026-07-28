import { resolveRequestAuth } from "@/lib/service-auth";
import { RecurringService } from "@/server/services/recurring.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const recurringService = new RecurringService();

export async function POST(request: Request) {
  try {
    const authResult = await resolveRequestAuth(request, "automation:trigger");
    if (!authResult) {
      return apiError("UNAUTHORIZED", "You must be signed in, or provide a service API key with automation:trigger scope, to run evaluation.", 401);
    }

    const counts = await recurringService.evaluateOccurrences(authResult.userId);
    return apiSuccess({
      message: "Occurrences evaluated and auto-generated successfully.",
      ...counts,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
