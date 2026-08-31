/**
 * src/server/services/data-reset.service.ts
 *
 * A single, deliberately dangerous action: wipes every transaction and
 * transaction-adjacent record for one user, and resets every stored
 * running balance (account, debt, saving goal) back to its starting
 * state. Account/category/debt/goal *setup* (names, targets, categories,
 * connected integrations) is untouched — this is a financial-history
 * reset, not an account deletion.
 *
 * Necessary because balances are stored running totals, not derived live
 * from transaction history (see Account.currentBalance, Debt.currentBalance,
 * SavingGoal.currentAmount) — deleting transactions alone would leave
 * every balance stale and disconnected from any transaction that actually
 * produced it.
 */

import "server-only";

import { db } from "@/lib/db";
import { AttachmentService } from "@/server/services/attachment.service";
import { AuditAction, AuditEntityType, DebtStatus, SavingGoalStatus, AttachmentStatus } from "@prisma/client";

export interface DataResetSummary {
  transactionsDeleted: number;
  debtPaymentsDeleted: number;
  savingTransactionsDeleted: number;
  remittancesDeleted: number;
  importedTransactionsDeleted: number;
  attachmentsDeleted: number;
  accountsReset: number;
  debtsReset: number;
  savingGoalsReset: number;
}

export class DataResetService {
  async resetAllFinancialData(userId: string): Promise<DataResetSummary> {
    // Attachment deletion involves external storage I/O — done first and
    // outside the DB transaction below (AttachmentService.delete is itself
    // atomic per-file; a mid-loop failure just leaves fewer attachments
    // deleted, not a torn DB/storage state).
    const attachments = await db.attachment.findMany({
      where: { userId, status: { not: AttachmentStatus.DELETED } },
      select: { id: true },
    });
    for (const attachment of attachments) {
      await AttachmentService.delete(userId, attachment.id);
    }

    const result = await db.$transaction(async (tx) => {
      const transactionsDeleted = await tx.transaction.deleteMany({ where: { userId } });
      const debtPaymentsDeleted = await tx.debtPayment.deleteMany({ where: { userId } });
      const savingTransactionsDeleted = await tx.savingTransaction.deleteMany({ where: { userId } });
      const remittancesDeleted = await tx.remittance.deleteMany({ where: { userId } });
      const importedTransactionsDeleted = await tx.importedTransaction.deleteMany({ where: { userId } });

      const accountsReset = await tx.account.updateMany({
        where: { userId },
        data: {
          currentBalance: 0,
          latestImportedBalance: null,
          lastSMSImportedAt: null,
          lastSuccessfulSyncAt: null,
        },
      });

      // Debt.currentBalance resets to Debt.originalBalance — a per-column
      // value, not a constant, so this can't be a single updateMany().
      const debts = await tx.debt.findMany({ where: { userId }, select: { id: true, originalBalance: true } });
      for (const debt of debts) {
        await tx.debt.update({
          where: { id: debt.id },
          data: { currentBalance: debt.originalBalance, status: DebtStatus.ACTIVE },
        });
      }

      const savingGoalsReset = await tx.savingGoal.updateMany({
        where: { userId },
        data: { currentAmount: 0, status: SavingGoalStatus.ACTIVE },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.ALL_FINANCIAL_DATA_RESET,
          entityType: AuditEntityType.USER,
          entityId: userId,
          metadata: {
            transactionsDeleted: transactionsDeleted.count,
            debtPaymentsDeleted: debtPaymentsDeleted.count,
            savingTransactionsDeleted: savingTransactionsDeleted.count,
            remittancesDeleted: remittancesDeleted.count,
            importedTransactionsDeleted: importedTransactionsDeleted.count,
            attachmentsDeleted: attachments.length,
            accountsReset: accountsReset.count,
            debtsReset: debts.length,
            savingGoalsReset: savingGoalsReset.count,
          },
        },
      });

      return {
        transactionsDeleted: transactionsDeleted.count,
        debtPaymentsDeleted: debtPaymentsDeleted.count,
        savingTransactionsDeleted: savingTransactionsDeleted.count,
        remittancesDeleted: remittancesDeleted.count,
        importedTransactionsDeleted: importedTransactionsDeleted.count,
        attachmentsDeleted: attachments.length,
        accountsReset: accountsReset.count,
        debtsReset: debts.length,
        savingGoalsReset: savingGoalsReset.count,
      };
    });

    return result;
  }
}

export const dataResetService = new DataResetService();
