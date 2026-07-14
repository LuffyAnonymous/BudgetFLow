import { auth } from "@/auth";
import { RecurringService } from "@/server/services/recurring.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { z } from "zod";

const recurringService = new RecurringService();

const handleOccurrenceSchema = z.object({
  action: z.enum(["COMPLETED", "SKIPPED"]),
  createTransaction: z.boolean().optional(),
  paymentMethod: z.string().max(50).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to handle reminders.", 401);
    }

    const { id } = await params;
    const body = await request.json();
    const valResult = handleOccurrenceSchema.safeParse(body);
    if (!valResult.success) {
      const errorMsg = valResult.error.issues[0]?.message || "Invalid input parameters.";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const updated = await recurringService.handleOccurrence(id, session.user.id, valResult.data);
    return apiSuccess({
      id: updated.id,
      status: updated.status,
      handledAt: updated.handledAt ? updated.handledAt.toISOString() : null,
      skippedAt: updated.skippedAt ? updated.skippedAt.toISOString() : null,
      linkedTransactionId: updated.linkedTransactionId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
