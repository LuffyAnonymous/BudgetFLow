import { auth } from "@/auth";
import { ReportService } from "@/server/services/report.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const reportService = new ReportService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view trends.", 401);
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!from || !to) {
      return apiError("BAD_REQUEST", "Parameters 'from' and 'to' in YYYY-MM format are required.", 400);
    }

    const trends = await reportService.getTrendsReport(session.user.id, from, to);
    return apiSuccess(trends);
  } catch (error) {
    return handleApiError(error);
  }
}
