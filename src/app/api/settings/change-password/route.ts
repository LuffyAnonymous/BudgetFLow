import { auth } from "@/auth";
import { SettingsService } from "@/server/services/settings.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { z } from "zod";

const settingsService = new SettingsService();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters long"),
  confirmPassword: z.string().min(8, "Confirm password is required"),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to change password.", 401);
    }

    const body = await request.json();
    const valResult = changePasswordSchema.safeParse(body);
    if (!valResult.success) {
      const errorMsg = valResult.error.issues[0]?.message || "Invalid input parameters.";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const result = await settingsService.changePassword(session.user.id, valResult.data);
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
