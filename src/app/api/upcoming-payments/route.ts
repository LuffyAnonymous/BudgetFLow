import { auth } from "@/auth";
import { UpcomingPaymentService } from "@/server/services/upcoming-payment.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const upcomingService = new UpcomingPaymentService();

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view upcoming payments.", 401);
    }

    const feed = await upcomingService.getUpcomingFeed(session.user.id);
    return apiSuccess(feed);
  } catch (error) {
    return handleApiError(error);
  }
}
