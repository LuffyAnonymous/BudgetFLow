import { auth } from "@/auth";
import { ReportService } from "@/server/services/report.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const reportService = new ReportService();

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view insights.", 401);
    }

    const recommendation = await reportService.getSpendingRecommendation(session.user.id);
    return apiSuccess(recommendation);
  } catch (error) {
    return handleApiError(error);
  }
}
