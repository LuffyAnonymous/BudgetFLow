import { db } from "@/lib/db";
import { RecurringOccurrenceStatus, DebtStatus, TransactionType } from "@prisma/client";
import { SettingsRepository } from "../repositories/settings.repository";
import { getLocalDateMidnight, formatLocalDateString } from "./recurring.service";

export interface UpcomingPaymentItem {
  id: string; // Unique UI key
  sourceType: "RECURRING_OCCURRENCE" | "DEBT" | "SAVING_GOAL" | "REMITTANCE_PLAN" | "GENERAL";
  sourceId: string; // original templateId or debtId
  occurrenceId?: string; // when applicable
  title: string;
  amount: string;
  dueDate: string; // YYYY-MM-DD
  status: "UPCOMING" | "DUE_TODAY" | "OVERDUE" | "HANDLED" | "SKIPPED";
  destinationPath: string;
  canMarkHandled: boolean;
  canSkip: boolean;
}

export class UpcomingPaymentService {
  private settingsRepo = new SettingsRepository();

  async getUpcomingFeed(userId: string): Promise<UpcomingPaymentItem[]> {
    const settings = await this.settingsRepo.findByUserId(userId);
    const tz = settings?.timezone || "Asia/Dubai";

    // 1. Get current date parts in user timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parts.find((p) => p.type === type)!.value;

    const currentYear = parseInt(getPart("year"), 10);
    const currentMonth = parseInt(getPart("month"), 10);
    const currentDay = parseInt(getPart("day"), 10);

    const todayMidnight = getLocalDateMidnight(currentYear, currentMonth, currentDay, tz);

    const feed: UpcomingPaymentItem[] = [];

    // 2. Fetch all PENDING/FAILED recurring occurrences
    const occurrences = await db.recurringOccurrence.findMany({
      where: {
        userId,
        status: { in: [RecurringOccurrenceStatus.PENDING, RecurringOccurrenceStatus.FAILED] },
      },
      include: {
        template: true,
      },
      orderBy: { scheduledDate: "asc" },
    });

    occurrences.forEach((occ) => {
      const scheduledMidnight = occ.scheduledDate;

      let status: UpcomingPaymentItem["status"] = "UPCOMING";
      if (scheduledMidnight.getTime() < todayMidnight.getTime()) {
        status = "OVERDUE";
      } else if (scheduledMidnight.getTime() === todayMidnight.getTime()) {
        status = "DUE_TODAY";
      }

      let destinationPath = "/transactions";
      if (occ.template.transactionType === TransactionType.DEBT_PAYMENT) destinationPath = "/debts";
      else if (occ.template.transactionType === TransactionType.SAVINGS) destinationPath = "/savings";
      else if (occ.template.transactionType === TransactionType.REMITTANCE) destinationPath = "/remittances";

      // Map template source types
      let sourceType: UpcomingPaymentItem["sourceType"] = "GENERAL";
      if (occ.template.sourceType === "DEBT") sourceType = "DEBT";
      else if (occ.template.sourceType === "SAVING_GOAL") sourceType = "SAVING_GOAL";
      else if (occ.template.sourceType === "REMITTANCE_PLAN") sourceType = "REMITTANCE_PLAN";

      feed.push({
        id: `occurrence-${occ.id}`,
        sourceType,
        sourceId: occ.recurringTemplateId,
        occurrenceId: occ.id,
        title: occ.template.name,
        amount: occ.template.amount.toFixed(2),
        dueDate: formatLocalDateString(occ.scheduledDate, tz),
        status,
        destinationPath,
        canMarkHandled: true,
        canSkip: true,
      });
    });

    // 3. Fetch active/paused debts to identify installment payments
    const debts = await db.debt.findMany({
      where: {
        userId,
        status: { in: [DebtStatus.ACTIVE, DebtStatus.PAUSED] },
      },
      include: {
        payments: {
          orderBy: { paymentDate: "desc" },
        },
      },
    });

    debts.forEach((debt) => {
      // Find expected due date for this debt in the active calendar month
      const maxDays = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
      const dueDay = Math.min(debt.dueDay, maxDays);
      const debtDueMidnight = getLocalDateMidnight(currentYear, currentMonth, dueDay, tz);

      // Check if a payment has been made in this current local month
      const paymentThisMonth = debt.payments.find((p) => {
        const pParts = this.getDatePartsInTz(p.paymentDate, tz);
        return pParts.year === currentYear && pParts.month === currentMonth;
      });

      let status: UpcomingPaymentItem["status"] = "UPCOMING";
      let canMarkHandled = true;

      if (paymentThisMonth) {
        status = "HANDLED";
        canMarkHandled = false;
      } else if (debtDueMidnight.getTime() < todayMidnight.getTime()) {
        status = "OVERDUE";
      } else if (debtDueMidnight.getTime() === todayMidnight.getTime()) {
        status = "DUE_TODAY";
      }

      feed.push({
        id: `debt-${debt.id}-${currentYear}-${currentMonth}`,
        sourceType: "DEBT",
        sourceId: debt.id,
        title: `Installment: ${debt.name}`,
        amount: debt.monthlyPayment.toFixed(2),
        dueDate: formatLocalDateString(debtDueMidnight, tz),
        status,
        destinationPath: "/debts",
        canMarkHandled,
        canSkip: false, // installment schedules cannot be skipped arbitrarily without transaction update
      });
    });

    // Sort feed: Handled and Skipped at the end, others ordered by dueDate asc, then amount desc
    return feed.sort((a, b) => {
      const getPriority = (s: string) => {
        if (s === "OVERDUE") return 1;
        if (s === "DUE_TODAY") return 2;
        if (s === "UPCOMING") return 3;
        return 4; // HANDLED, SKIPPED
      };
      
      const priorityA = getPriority(a.status);
      const priorityB = getPriority(b.status);
      if (priorityA !== priorityB) return priorityA - priorityB;

      // secondary sort by due date
      return a.dueDate.localeCompare(b.dueDate);
    });
  }

  private getDatePartsInTz(date: Date, tz: string) {
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
    };
  }
}
