import { auth } from "@/auth";
import { NotificationService } from "@/server/services/notification.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const notificationService = new NotificationService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view notifications.", 401);
    }

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

    const result = await notificationService.getNotifications(session.user.id, {
      unreadOnly,
      page,
      pageSize,
    });

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
