import { auth } from "@/auth";
import { NotificationService } from "@/server/services/notification.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const notificationService = new NotificationService();

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to evaluate notifications.", 401);
    }

    const result = await notificationService.evaluateNotifications(session.user.id);
    return apiSuccess({
      message: "Notifications evaluated successfully.",
      ...result,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
