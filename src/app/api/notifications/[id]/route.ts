import { auth } from "@/auth";
import { NotificationService } from "@/server/services/notification.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { z } from "zod";

const notificationService = new NotificationService();

const updateNotificationSchema = z.object({
  read: z.boolean().optional(),
  dismissed: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to modify notification.", 401);
    }

    const { id } = await params;
    const body = await request.json();
    const valResult = updateNotificationSchema.safeParse(body);
    if (!valResult.success) {
      const errorMsg = valResult.error.issues[0]?.message || "Invalid notification parameters.";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const payload = valResult.data;
    let result;
    if (payload.read !== undefined) {
      result = await notificationService.markAsRead(id, session.user.id);
    } else if (payload.dismissed !== undefined) {
      result = await notificationService.dismiss(id, session.user.id);
    } else {
      return apiError("BAD_REQUEST", "No modification parameter specified.", 400);
    }

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
