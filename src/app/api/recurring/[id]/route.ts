import { auth } from "@/auth";
import { RecurringService } from "@/server/services/recurring.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { z } from "zod";
import { RecurringStatus } from "@prisma/client";

const recurringService = new RecurringService();

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  amount: z.coerce.number().positive().optional(),
  notes: z.string().max(500).nullable().optional(),
  status: z.nativeEnum(RecurringStatus).optional(),
  reminderEnabled: z.boolean().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view template details.", 401);
    }

    const { id } = await params;
    const template = await recurringService.getTemplateById(id, session.user.id);

    return apiSuccess({
      id: template.id,
      name: template.name,
      transactionType: template.transactionType,
      amount: template.amount.toFixed(2),
      frequency: template.frequency,
      startDate: template.startDate.toISOString(),
      endDate: template.endDate ? template.endDate.toISOString() : null,
      dueDay: template.dueDay,
      autoCreate: template.autoCreate,
      reminderEnabled: template.reminderEnabled,
      notes: template.notes,
      status: template.status,
      sourceType: template.sourceType,
      sourceEntityId: template.sourceEntityId,
      categoryId: template.categoryId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to update template.", 401);
    }

    const { id } = await params;
    const body = await request.json();
    const valResult = updateTemplateSchema.safeParse(body);
    if (!valResult.success) {
      const errorMsg = valResult.error.issues[0]?.message || "Invalid update properties.";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = valResult.data;
    const updated = await recurringService.updateTemplate(id, session.user.id, valData);

    return apiSuccess({
      id: updated.id,
      name: updated.name,
      amount: updated.amount.toFixed(2),
      status: updated.status,
      reminderEnabled: updated.reminderEnabled,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
