import { resolveRequestAuth } from "@/lib/service-auth";
import { NotificationService } from "@/server/services/notification.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const notificationService = new NotificationService();

export async function POST(request: Request) {
  try {
    const authResult = await resolveRequestAuth(request, "automation:trigger");
    if (!authResult) {
      return apiError("UNAUTHORIZED", "You must be signed in, or provide a service API key with automation:trigger scope, to evaluate notifications.", 401);
    }

    const result = await notificationService.evaluateNotifications(authResult.userId);
    return apiSuccess({
      message: "Notifications evaluated successfully.",
      ...result,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
