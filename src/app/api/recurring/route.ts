import { auth } from "@/auth";
import { RecurringService } from "@/server/services/recurring.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { z } from "zod";
import { TransactionType, RecurringFrequency } from "@prisma/client";

const recurringService = new RecurringService();

const createTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  transactionType: z.nativeEnum(TransactionType),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  frequency: z.nativeEnum(RecurringFrequency),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid start date format",
  }),
  endDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid end date format",
  }).nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
  autoCreate: z.boolean().optional(),
  reminderEnabled: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  sourceType: z.enum(["DEBT", "SAVING_GOAL", "REMITTANCE_PLAN", "GENERAL"]).optional(),
  sourceEntityId: z.string().uuid().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view templates.", 401);
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    let statusFilter: import("@prisma/client").RecurringStatus | undefined = undefined;
    if (statusParam === "ACTIVE" || statusParam === "PAUSED" || statusParam === "ARCHIVED") {
      statusFilter = statusParam as import("@prisma/client").RecurringStatus;
    }

    const templates = await recurringService.getTemplates(session.user.id, statusFilter);
    const serialized = templates.map((t) => ({
      id: t.id,
      name: t.name,
      transactionType: t.transactionType,
      amount: t.amount.toFixed(2),
      frequency: t.frequency,
      startDate: t.startDate.toISOString(),
      endDate: t.endDate ? t.endDate.toISOString() : null,
      dueDay: t.dueDay,
      autoCreate: t.autoCreate,
      reminderEnabled: t.reminderEnabled,
      notes: t.notes,
      status: t.status,
      sourceType: t.sourceType,
      sourceEntityId: t.sourceEntityId,
      categoryId: t.categoryId,
    }));

    return apiSuccess(serialized);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to create a template.", 401);
    }

    const body = await request.json();
    const valResult = createTemplateSchema.safeParse(body);
    if (!valResult.success) {
      const errorMsg = valResult.error.issues[0]?.message || "Invalid template options.";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const payload = valResult.data;
    const template = await recurringService.createTemplate(session.user.id, {
      ...payload,
      startDate: new Date(payload.startDate),
      endDate: payload.endDate ? new Date(payload.endDate) : null,
    });

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
