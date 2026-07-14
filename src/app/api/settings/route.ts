import { auth } from "@/auth";
import { SettingsService } from "@/server/services/settings.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { z } from "zod";

const settingsService = new SettingsService();

const updatePreferencesSchema = z.object({
  name: z.string().min(1, "Name cannot be empty").max(100).optional(),
  monthlySalary: z.coerce.number().nonnegative("Monthly salary must be non-negative").optional(),
  payday: z.coerce.number().int().min(1).max(31).optional(),
  currency: z.string().toUpperCase().optional(),
  timezone: z.string().optional(),
  theme: z.string().toLowerCase().optional(),
  defaultPageSize: z.coerce.number().int().optional(),
  foodGroupKey: z.string().max(50).optional(),
  reminderLeadDays: z.coerce.number().int().min(0).max(30).optional(),
  notificationPref: z.object({
    upcomingPaymentsEnabled: z.boolean(),
    overduePaymentsEnabled: z.boolean(),
    budgetAlertsEnabled: z.boolean(),
    savingsAlertsEnabled: z.boolean(),
    rolloverAlertsEnabled: z.boolean(),
  }).optional(),
  rolloverPref: z.object({
    copyBudgets: z.boolean(),
    reviewOverdueReminders: z.boolean(),
  }).optional(),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view settings.", 401);
    }

    const data = await settingsService.getSettings(session.user.id);
    return apiSuccess({
      name: data.name,
      email: data.email,
      monthlySalary: data.setting?.monthlySalary.toFixed(2) || "0.00",
      payday: data.setting?.payday || 25,
      currency: data.setting?.currency || "AED",
      timezone: data.setting?.timezone || "Asia/Dubai",
      theme: data.setting?.theme || "system",
      defaultPageSize: data.setting?.defaultPageSize || 10,
      foodGroupKey: data.setting?.foodGroupKey || "FOOD",
      reminderLeadDays: data.setting?.reminderLeadDays || 3,
      notificationPref: data.setting?.notificationPref || null,
      rolloverPref: data.setting?.rolloverPref || null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to update settings.", 401);
    }

    const body = await request.json();
    const valResult = updatePreferencesSchema.safeParse(body);
    if (!valResult.success) {
      const errorMsg = valResult.error.issues[0]?.message || "Invalid preference options";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const updated = await settingsService.updatePreferences(session.user.id, valResult.data);
    return apiSuccess({
      monthlySalary: updated.monthlySalary.toFixed(2),
      payday: updated.payday,
      currency: updated.currency,
      timezone: updated.timezone,
      theme: updated.theme,
      defaultPageSize: updated.defaultPageSize,
      foodGroupKey: updated.foodGroupKey,
      reminderLeadDays: updated.reminderLeadDays,
      notificationPref: updated.notificationPref,
      rolloverPref: updated.rolloverPref,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
