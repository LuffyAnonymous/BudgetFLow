import { auth } from "@/auth";
import { ReportService } from "@/server/services/report.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { getDubaiCurrentDate } from "@/lib/dates";

const reportService = new ReportService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view reports.", 401);
    }

    const { searchParams } = new URL(request.url);
    let month = searchParams.get("month");

    if (!month) {
      const nowDubai = getDubaiCurrentDate();
      month = `${nowDubai.year}-${String(nowDubai.month).padStart(2, "0")}`;
    }

    const report = await reportService.getMonthlyReport(session.user.id, month);
    return apiSuccess(report);
  } catch (error) {
    return handleApiError(error);
  }
}
