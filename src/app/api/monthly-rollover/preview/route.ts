import { auth } from "@/auth";
import { MonthlyRolloverService } from "@/server/services/monthly-rollover.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const rolloverService = new MonthlyRolloverService();

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view rollover preview.", 401);
    }

    const { searchParams } = new URL(request.url);
    const sourceMonth = searchParams.get("from");
    const targetMonth = searchParams.get("to");

    if (!sourceMonth || !targetMonth) {
      return apiError("BAD_REQUEST", "Missing 'from' or 'to' parameters. Format: YYYY-MM", 400);
    }

    const preview = await rolloverService.getRolloverPreview(session.user.id, sourceMonth, targetMonth);
    return apiSuccess(preview);
  } catch (error) {
    return handleApiError(error);
  }
}
