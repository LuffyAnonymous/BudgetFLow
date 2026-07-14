import { auth } from "@/auth";
import { DashboardService } from "@/server/services/dashboard.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const dashboardService = new DashboardService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in.", 401);
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || undefined;

    const data = await dashboardService.getDashboardData(session.user.id, month);
    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error);
  }
}
