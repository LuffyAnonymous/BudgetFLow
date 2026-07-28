import { resolveRequestAuth } from "@/lib/service-auth";
import { MonthlyRolloverService } from "@/server/services/monthly-rollover.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { z } from "zod";

const rolloverService = new MonthlyRolloverService();

const confirmRolloverSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}$/, "Source month must be YYYY-MM"),
  to: z.string().regex(/^\d{4}-\d{2}$/, "Target month must be YYYY-MM"),
});

export async function POST(request: Request) {
  try {
    const authResult = await resolveRequestAuth(request, "automation:trigger");
    if (!authResult) {
      return apiError("UNAUTHORIZED", "You must be signed in, or provide a service API key with automation:trigger scope, to confirm rollover.", 401);
    }

    const body = await request.json();
    const valResult = confirmRolloverSchema.safeParse(body);
    if (!valResult.success) {
      const errorMsg = valResult.error.issues[0]?.message || "Invalid month format.";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const payload = valResult.data;
    const result = await rolloverService.confirmRollover(authResult.userId, payload.from, payload.to);

    return apiSuccess({
      id: result.id,
      sourceMonth: result.sourceMonth,
      targetMonth: result.targetMonth,
      status: result.status,
      copiedBudgetCount: result.copiedBudgetCount,
      confirmedAt: result.confirmedAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
