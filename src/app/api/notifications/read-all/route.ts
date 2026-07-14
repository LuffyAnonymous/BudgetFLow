import { auth } from "@/auth";
import { NotificationService } from "@/server/services/notification.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const notificationService = new NotificationService();

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to mark all notifications as read.", 401);
    }

    const count = await notificationService.markAllAsRead(session.user.id);
    return apiSuccess({
      message: "All notifications marked as read.",
      count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
