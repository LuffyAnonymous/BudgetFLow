import { SettingsRepository } from "../repositories/settings.repository";
import { db } from "@/lib/db";
import { Setting, Prisma, AuditAction, AuditEntityType } from "@prisma/client";
import bcryptjs from "bcryptjs";
import { Decimal } from "decimal.js";
import { AuditLogService } from "./audit-log.service";

const SUPPORTED_CURRENCIES = ["AED", "PHP", "USD", "EUR", "GBP"];
const SUPPORTED_THEMES = ["system", "light", "dark"];
const SUPPORTED_PAGE_SIZES = [10, 20, 50, 100];

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface UpdatePreferencesInput {
  name?: string;
  monthlySalary?: number | string | Decimal;
  payday?: number;
  currency?: string;
  timezone?: string;
  theme?: string;
  defaultPageSize?: number;
  foodGroupKey?: string;
  reminderLeadDays?: number;
  notificationPref?: {
    upcomingPaymentsEnabled: boolean;
    overduePaymentsEnabled: boolean;
    budgetAlertsEnabled: boolean;
    savingsAlertsEnabled: boolean;
    rolloverAlertsEnabled: boolean;
  };
  rolloverPref?: {
    copyBudgets: boolean;
    reviewOverdueReminders: boolean;
  };
}

export class SettingsService {
  private settingsRepo = new SettingsRepository();

  async getSettings(userId: string): Promise<{ setting: Setting | null; name: string | null; email: string }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const setting = await this.settingsRepo.findByUserId(userId);
    return {
      setting,
      name: user.name,
      email: user.email,
    };
  }

  async updatePreferences(userId: string, input: UpdatePreferencesInput): Promise<Setting> {
    // 1. Validations
    if (input.monthlySalary !== undefined) {
      const salary = new Decimal(input.monthlySalary);
      if (salary.lessThan(0)) {
        throw new Error("INVALID_SALARY: Monthly salary must be non-negative.");
      }
    }

    if (input.payday !== undefined) {
      if (!Number.isInteger(input.payday) || input.payday < 1 || input.payday > 31) {
        throw new Error("INVALID_PAYDAY: Payday must be an integer between 1 and 31.");
      }
    }

    if (input.currency !== undefined) {
      if (!SUPPORTED_CURRENCIES.includes(input.currency.toUpperCase())) {
        throw new Error(`INVALID_CURRENCY: Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
      }
    }

    if (input.timezone !== undefined) {
      if (!isValidTimezone(input.timezone)) {
        throw new Error("INVALID_TIMEZONE: Invalid IANA timezone string.");
      }
    }

    if (input.theme !== undefined) {
      if (!SUPPORTED_THEMES.includes(input.theme.toLowerCase())) {
        throw new Error("INVALID_THEME: Theme must be system, light, or dark.");
      }
    }

    if (input.defaultPageSize !== undefined) {
      if (!SUPPORTED_PAGE_SIZES.includes(input.defaultPageSize)) {
        throw new Error("INVALID_PAGE_SIZE: Default page size must be 10, 20, 50, or 100.");
      }
    }

    if (input.reminderLeadDays !== undefined) {
      if (!Number.isInteger(input.reminderLeadDays) || input.reminderLeadDays < 0 || input.reminderLeadDays > 30) {
        throw new Error("INVALID_LEAD_DAYS: Reminder lead days must be between 0 and 30.");
      }
    }

    // Update name on User table if provided
    if (input.name !== undefined) {
      await db.user.update({
        where: { id: userId },
        data: { name: input.name.trim() },
      });
    }

    // Prep setting updates merging existing or default values
    const existing = await this.settingsRepo.findByUserId(userId);
    
    const monthlySalary = input.monthlySalary !== undefined ? new Decimal(input.monthlySalary) : (existing ? existing.monthlySalary : new Decimal(0));
    const payday = input.payday !== undefined ? input.payday : (existing ? existing.payday : 25);
    const currency = input.currency !== undefined ? input.currency.toUpperCase() : (existing ? existing.currency : "AED");
    const timezone = input.timezone !== undefined ? input.timezone : (existing ? existing.timezone : "Asia/Dubai");
    const theme = input.theme !== undefined ? input.theme.toLowerCase() : (existing ? existing.theme : "system");
    const defaultPageSize = input.defaultPageSize !== undefined ? input.defaultPageSize : (existing ? existing.defaultPageSize : 10);
    const foodGroupKey = input.foodGroupKey !== undefined ? input.foodGroupKey.trim() : (existing ? existing.foodGroupKey : "FOOD");
    const reminderLeadDays = input.reminderLeadDays !== undefined ? input.reminderLeadDays : (existing ? existing.reminderLeadDays : 3);
    const notificationPref = input.notificationPref !== undefined ? input.notificationPref : (existing ? (existing.notificationPref || Prisma.JsonNull) : Prisma.JsonNull);
    const rolloverPref = input.rolloverPref !== undefined ? input.rolloverPref : (existing ? (existing.rolloverPref || Prisma.JsonNull) : Prisma.JsonNull);

    const updateData: Omit<Prisma.SettingUncheckedCreateInput, "userId"> = {
      monthlySalary,
      payday,
      currency,
      timezone,
      theme,
      defaultPageSize,
      foodGroupKey,
      reminderLeadDays,
      notificationPref,
      rolloverPref,
    };

    return this.settingsRepo.upsert(userId, updateData);
  }

  async changePassword(
    userId: string,
    data: { currentPassword: string; newPassword: string; confirmPassword: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!data.currentPassword || !data.newPassword || !data.confirmPassword) {
      throw new Error("MISSING_PASSWORD_FIELDS: All password fields are required.");
    }

    if (data.newPassword !== data.confirmPassword) {
      throw new Error("PASSWORD_MISMATCH: New password and confirmation do not match.");
    }

    if (data.newPassword.length < 8) {
      throw new Error("INVALID_PASSWORD: New password must be at least 8 characters long.");
    }

    if (data.newPassword === data.currentPassword) {
      throw new Error("PASSWORD_SAME_AS_CURRENT: New password cannot be equal to the current password.");
    }

    const user = await db.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    // Verify current password hash
    const isValid = await bcryptjs.compare(data.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new Error("INVALID_CURRENT_PASSWORD: The current password you entered is incorrect.");
    }

    // Hash new password
    const hashed = await bcryptjs.hash(data.newPassword, 12);

    // Update password hash + increment sessionVersion + write audit entry atomically
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: hashed,
          sessionVersion: { increment: 1 },
        },
      });

      // Audit: do NOT log before/after hash values — they are automatically redacted
      // but we log the action itself for compliance
      await AuditLogService.log(
        {
          userId,
          action: AuditAction.CHANGE_PASSWORD,
          entityType: AuditEntityType.USER,
          entityId: userId,
          after: { sessionVersionIncremented: true },
        },
        tx
      );
    });

    return {
      success: true,
      message: "Password updated successfully. Other active sessions have been invalidated.",
    };
  }
}
