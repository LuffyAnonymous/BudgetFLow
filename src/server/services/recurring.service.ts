import { RecurringTemplateRepository } from "../repositories/recurring-template.repository";
import { RecurringOccurrenceRepository } from "../repositories/recurring-occurrence.repository";
import { SettingsRepository } from "../repositories/settings.repository";
import { TransactionRepository } from "../repositories/transaction.repository";
import { CategoryRepository } from "../repositories/category.repository";
import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import {
  RecurringTemplate,
  RecurringOccurrence,
  RecurringFrequency,
  RecurringStatus,
  RecurringOccurrenceStatus,
  TransactionType,
  CashFlowDirection,
  Prisma,
  CategoryType,
} from "@prisma/client";

// Native timezone-safe midnight date generator
export function getLocalDateMidnight(year: number, month: number, day: number, tz: string): Date {
  const testDate = new Date(Date.UTC(year, month - 1, day));
  
  const options = {
    timeZone: tz,
    year: "numeric" as const,
    month: "numeric" as const,
    day: "numeric" as const,
    hour: "numeric" as const,
    minute: "numeric" as const,
    second: "numeric" as const,
  };
  
  const formatter = new Intl.DateTimeFormat("en-US", options);
  const parts = formatter.formatToParts(testDate);
  const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  
  const formattedY = getPart("year");
  const formattedM = getPart("month");
  const formattedD = getPart("day");
  const formattedH = getPart("hour");
  
  const utcTest = testDate.getTime();
  const localTest = Date.UTC(formattedY, formattedM - 1, formattedD, formattedH);
  const offset = localTest - utcTest;
  
  const targetLocalTime = Date.UTC(year, month - 1, day);
  return new Date(targetLocalTime - offset);
}

// Convert Date object to YYYY-MM-DD string in local timezone
export function formatLocalDateString(date: Date, tz: string): string {
  const options = {
    timeZone: tz,
    year: "numeric" as const,
    month: "numeric" as const,
    day: "numeric" as const,
  };
  const formatter = new Intl.DateTimeFormat("en-US", options);
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((p) => p.type === type)!.value;
  
  const y = getPart("year");
  const m = getPart("month").padStart(2, "0");
  const d = getPart("day").padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export class RecurringService {
  private templateRepo = new RecurringTemplateRepository();
  private occurrenceRepo = new RecurringOccurrenceRepository();
  private settingsRepo = new SettingsRepository();
  private transactionRepo = new TransactionRepository();
  private categoryRepo = new CategoryRepository();

  async getTemplates(userId: string, status?: RecurringStatus): Promise<RecurringTemplate[]> {
    return this.templateRepo.findMany(userId, { status });
  }

  async getTemplateById(id: string, userId: string): Promise<RecurringTemplate> {
    const template = await this.templateRepo.findById(id, userId);
    if (!template) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }
    return template;
  }

  async createTemplate(
    userId: string,
    data: {
      name: string;
      transactionType: TransactionType;
      amount: number | string | Decimal;
      frequency: RecurringFrequency;
      startDate: Date | string;
      endDate?: Date | string | null;
      dueDay?: number | null;
      autoCreate?: boolean;
      reminderEnabled?: boolean;
      notes?: string | null;
      categoryId?: string | null;
      sourceType?: import("@prisma/client").RecurringSourceType;
      sourceEntityId?: string | null;
    }
  ): Promise<RecurringTemplate> {
    // Validations
    if (data.frequency !== RecurringFrequency.MONTHLY) {
      throw new Error("UNSUPPORTED_FREQUENCY: Only MONTHLY frequency is supported in the MVP.");
    }

    const amount = new Decimal(data.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new Error("INVALID_AMOUNT: Amount must be greater than zero.");
    }

    const autoCreate = data.autoCreate || false;
    const isSpecialType =
      data.transactionType === TransactionType.DEBT_PAYMENT ||
      data.transactionType === TransactionType.SAVINGS ||
      data.transactionType === TransactionType.REMITTANCE;

    if (autoCreate && isSpecialType) {
      throw new Error("AUTO_CREATE_UNSUPPORTED: Auto-creation is only supported for INCOME and EXPENSE types.");
    }

    if (autoCreate && !data.categoryId) {
      throw new Error("CATEGORY_REQUIRED: A category is required when autoCreate is enabled.");
    }

    const settings = await this.settingsRepo.findByUserId(userId);
    const tz = settings?.timezone || "Asia/Dubai";

    const startD = typeof data.startDate === "string" ? new Date(data.startDate) : data.startDate;
    const endD = data.endDate ? (typeof data.endDate === "string" ? new Date(data.endDate) : data.endDate) : null;

    const startParts = this.getDateParts(startD, tz);
    const normalizedStart = getLocalDateMidnight(startParts.year, startParts.month, startParts.day, tz);

    let normalizedEnd: Date | null = null;
    if (endD) {
      const endParts = this.getDateParts(endD, tz);
      normalizedEnd = getLocalDateMidnight(endParts.year, endParts.month, endParts.day, tz);
    }

    const dueDay = data.dueDay !== undefined && data.dueDay !== null ? data.dueDay : startParts.day;

    if (dueDay < 1 || dueDay > 31) {
      throw new Error("INVALID_DUE_DAY: Due day must be between 1 and 31.");
    }

    // Validate category compatibility if categoryId is provided
    if (data.categoryId) {
      const category = await this.categoryRepo.findByIdAndUserId(data.categoryId, userId);
      if (!category) {
        throw new Error("CATEGORY_NOT_FOUND: Category not found or unauthorized.");
      }
      if (autoCreate) {
        if (data.transactionType === TransactionType.INCOME && category.type !== CategoryType.INCOME) {
          throw new Error("INCOMPATIBLE_CATEGORY: INCOME type requires an INCOME category.");
        }
        if (data.transactionType === TransactionType.EXPENSE &&
            category.type !== CategoryType.FIXED_EXPENSE &&
            category.type !== CategoryType.VARIABLE_EXPENSE) {
          throw new Error("INCOMPATIBLE_CATEGORY: EXPENSE type requires a FIXED_EXPENSE or VARIABLE_EXPENSE category.");
        }
      }
    }

    // Verify sourceEntity if specified
    if (data.sourceEntityId && data.sourceType) {
      if (data.sourceType === "DEBT") {
        const debt = await db.debt.findFirst({ where: { id: data.sourceEntityId, userId } });
        if (!debt) throw new Error("SOURCE_ENTITY_NOT_FOUND");
      } else if (data.sourceType === "SAVING_GOAL") {
        const goal = await db.savingGoal.findFirst({ where: { id: data.sourceEntityId, userId } });
        if (!goal) throw new Error("SOURCE_ENTITY_NOT_FOUND");
      }
    }

    return this.templateRepo.create(userId, {
      name: data.name,
      transactionType: data.transactionType,
      amount,
      frequency: data.frequency,
      startDate: normalizedStart,
      endDate: normalizedEnd,
      dueDay,
      autoCreate,
      reminderEnabled: data.reminderEnabled ?? true,
      notes: data.notes || null,
      status: RecurringStatus.ACTIVE,
      sourceType: data.sourceType || "GENERAL",
      sourceEntityId: data.sourceEntityId || null,
      categoryId: data.categoryId || null,
    });
  }

  async updateTemplate(
    id: string,
    userId: string,
    data: Prisma.RecurringTemplateUncheckedUpdateInput
  ): Promise<RecurringTemplate> {
    const template = await this.templateRepo.findById(id, userId);
    if (!template) {
      throw new Error("TEMPLATE_NOT_FOUND");
    }

    // Block updating frequency to anything other than MONTHLY
    if (data.frequency && data.frequency !== RecurringFrequency.MONTHLY) {
      throw new Error("UNSUPPORTED_FREQUENCY: Only MONTHLY frequency is supported.");
    }

    return this.templateRepo.update(id, userId, data);
  }

  async archiveTemplate(id: string, userId: string): Promise<RecurringTemplate> {
    return this.updateTemplate(id, userId, { status: RecurringStatus.ARCHIVED });
  }

  /**
   * Generates and processes missing occurrences for a user within a bounded range
   */
  async evaluateOccurrences(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{ created: number; completed: number; failed: number; skipped: number }> {
    const settings = await this.settingsRepo.findByUserId(userId);
    const tz = settings?.timezone || "Asia/Dubai";

    // Horizon: defaults from now - 30 days up to now + lead days (or next month)
    const leadDays = settings?.reminderLeadDays ?? 3;
    const now = new Date();

    let evalStart = startDate;
    if (evalStart) {
      const parts = this.getDateParts(evalStart, tz);
      evalStart = getLocalDateMidnight(parts.year, parts.month, parts.day, tz);
    } else {
      evalStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const parts = this.getDateParts(evalStart, tz);
      evalStart = getLocalDateMidnight(parts.year, parts.month, parts.day, tz);
    }

    let evalEnd = endDate;
    if (evalEnd) {
      const parts = this.getDateParts(evalEnd, tz);
      evalEnd = getLocalDateMidnight(parts.year, parts.month, parts.day, tz);
    } else {
      evalEnd = new Date(now.getTime() + (leadDays + 30) * 24 * 60 * 60 * 1000);
      const parts = this.getDateParts(evalEnd, tz);
      evalEnd = getLocalDateMidnight(parts.year, parts.month, parts.day, tz);
    }

    const templates = await this.templateRepo.findMany(userId, { status: RecurringStatus.ACTIVE });

    let createdCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const template of templates) {

      const tStartParts = this.getDateParts(template.startDate, tz);
      const evalEndParts = this.getDateParts(evalEnd, tz);

      const totalMonths = (evalEndParts.year - tStartParts.year) * 12 + (evalEndParts.month - tStartParts.month) + 1;

      for (let i = 0; i < totalMonths; i++) {
        const currentMonthVal = tStartParts.month + i;
        const year = tStartParts.year + Math.floor((currentMonthVal - 1) / 12);
        const month = ((currentMonthVal - 1) % 12) + 1;

        // Cap due day to month max
        const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const dueDay = Math.min(template.dueDay || tStartParts.day, maxDays);

        const scheduledDate = getLocalDateMidnight(year, month, dueDay, tz);

        // Verify boundaries
        if (scheduledDate.getTime() < template.startDate.getTime()) continue;
        if (scheduledDate.getTime() > evalEnd.getTime()) continue;
        if (template.endDate && scheduledDate.getTime() > template.endDate.getTime()) continue;
        if (scheduledDate.getTime() < evalStart.getTime()) continue;

        const dateStr = formatLocalDateString(scheduledDate, tz);
        const idempotencyKey = `recurring:${template.id}:${dateStr}`;

        // Atomic check and creation
        const existing = await this.occurrenceRepo.findByIdempotencyKey(userId, idempotencyKey);
        if (existing) continue;

        createdCount++;

        // Process occurrence atomically
        try {
          const result = await this.processOccurrence(userId, template.id, scheduledDate, idempotencyKey);
          if (result.status === RecurringOccurrenceStatus.COMPLETED) {
            completedCount++;
          } else if (result.status === RecurringOccurrenceStatus.FAILED) {
            failedCount++;
          } else {
            skippedCount++;
          }
        } catch (err) {
          console.error("Failed to process occurrence:", err);
          failedCount++;
        }
      }
    }

    return {
      created: createdCount,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
    };
  }

  private async processOccurrence(
    userId: string,
    templateId: string,
    scheduledDate: Date,
    idempotencyKey: string
  ): Promise<RecurringOccurrence> {
    return db.$transaction(async (tx) => {
      // Re-verify uniqueness inside transaction
      const existing = await tx.recurringOccurrence.findFirst({
        where: { userId, idempotencyKey },
      });
      if (existing) return existing;

      const template = await tx.recurringTemplate.findFirst({
        where: { id: templateId, userId },
      });
      if (!template) throw new Error("TEMPLATE_NOT_FOUND");

      if (!template.autoCreate) {
        // Reminder-only template -> Create PENDING occurrence
        return tx.recurringOccurrence.create({
          data: {
            userId,
            recurringTemplateId: template.id,
            scheduledDate,
            status: RecurringOccurrenceStatus.PENDING,
            idempotencyKey,
          },
        });
      }

      // Auto-create logic
      let linkedTransactionId: string | null = null;
      let status: RecurringOccurrenceStatus = RecurringOccurrenceStatus.COMPLETED;
      let failureReason: string | null = null;
      let processedAt: Date | null = new Date();

      try {
        // Validate category exists and is active
        if (!template.categoryId) {
          throw new Error("MISSING_CATEGORY");
        }
        const category = await tx.category.findFirst({
          where: { id: template.categoryId, userId },
        });
        if (!category) {
          throw new Error("CATEGORY_INCOMPATIBLE");
        }

        // Validate type checks
        if (template.transactionType === TransactionType.INCOME && category.type !== CategoryType.INCOME) {
          throw new Error("CATEGORY_INCOMPATIBLE");
        }
        if (template.transactionType === TransactionType.EXPENSE &&
            category.type !== CategoryType.FIXED_EXPENSE &&
            category.type !== CategoryType.VARIABLE_EXPENSE) {
          throw new Error("CATEGORY_INCOMPATIBLE");
        }

        const isIncome = template.transactionType === TransactionType.INCOME;

        const ledgerTx = await tx.transaction.create({
          data: {
            userId,
            date: scheduledDate,
            categoryId: template.categoryId,
            description: template.name,
            amount: template.amount,
            paymentMethod: "Recurring Auto",
            type: template.transactionType,
            cashFlowDirection: isIncome ? CashFlowDirection.INFLOW : CashFlowDirection.OUTFLOW,
          },
        });
        linkedTransactionId = ledgerTx.id;
      } catch (err) {
        status = RecurringOccurrenceStatus.FAILED;
        failureReason = err instanceof Error ? err.message : "Auto-creation failed validation checks.";
        processedAt = null;
      }

      return tx.recurringOccurrence.create({
        data: {
          userId,
          recurringTemplateId: template.id,
          scheduledDate,
          status,
          processedAt,
          failureReason,
          linkedTransactionId,
          idempotencyKey,
        },
      });
    });
  }

  async handleOccurrence(
    occurrenceId: string,
    userId: string,
    data: { action: "COMPLETED" | "SKIPPED"; createTransaction?: boolean; paymentMethod?: string }
  ): Promise<RecurringOccurrence> {
    return db.$transaction(async (tx) => {
      const occurrence = await tx.recurringOccurrence.findFirst({
        where: { id: occurrenceId, userId },
        include: { template: true },
      });
      if (!occurrence) {
        throw new Error("OCCURRENCE_NOT_FOUND");
      }
      if (occurrence.status !== RecurringOccurrenceStatus.PENDING) {
        throw new Error("OCCURRENCE_ALREADY_PROCESSED: This occurrence has already been processed.");
      }

      if (data.action === "SKIPPED") {
        return tx.recurringOccurrence.update({
          where: { id: occurrenceId, userId },
          data: {
            status: RecurringOccurrenceStatus.SKIPPED,
            skippedAt: new Date(),
          },
        });
      }

      let linkedTransactionId: string | null = null;

      if (data.createTransaction &&
          (occurrence.template.transactionType === TransactionType.INCOME ||
           occurrence.template.transactionType === TransactionType.EXPENSE)) {
        if (!occurrence.template.categoryId) {
          throw new Error("CATEGORY_REQUIRED: Template does not have a ledger category to record transaction.");
        }
        const isIncome = occurrence.template.transactionType === TransactionType.INCOME;

        const ledgerTx = await tx.transaction.create({
          data: {
            userId,
            date: occurrence.scheduledDate,
            categoryId: occurrence.template.categoryId,
            description: occurrence.template.name,
            amount: occurrence.template.amount,
            paymentMethod: data.paymentMethod || "Manual",
            type: occurrence.template.transactionType,
            cashFlowDirection: isIncome ? CashFlowDirection.INFLOW : CashFlowDirection.OUTFLOW,
          },
        });
        linkedTransactionId = ledgerTx.id;
      }

      return tx.recurringOccurrence.update({
        where: { id: occurrenceId, userId },
        data: {
          status: RecurringOccurrenceStatus.COMPLETED,
          handledAt: new Date(),
          processedAt: new Date(),
          linkedTransactionId,
        },
      });
    });
  }

  private getDateParts(date: Date, tz: string) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)!.value;
    return {
      year: parseInt(getPart("year"), 10),
      month: parseInt(getPart("month"), 10),
      day: parseInt(getPart("day"), 10),
    };
  }
}
