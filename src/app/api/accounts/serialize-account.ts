import { accountService } from "@/server/services/account.service";
import type { Account } from "@prisma/client";

export async function serializeAccountWithReconciliation(userId: string, acc: Account) {
  const recon = await accountService.reconcileAccountBalance(userId, acc.id);
  return {
    id: acc.id,
    type: acc.type,
    name: acc.name,
    isCreditCard: acc.isCreditCard,
    isPrimary: acc.isPrimary,
    currentBalance: acc.currentBalance.toFixed(2),
    latestImportedBalance: acc.latestImportedBalance ? acc.latestImportedBalance.toFixed(2) : null,
    lastSMSImported: acc.lastSMSImportedAt ? acc.lastSMSImportedAt.toISOString() : null,
    lastSuccessfulSync: acc.lastSuccessfulSyncAt ? acc.lastSuccessfulSyncAt.toISOString() : null,
    reconciliationStatus: recon.reconciliationStatus,
    cacheDifference: recon.cacheDifference.toFixed(2),
    bankDifference: recon.bankDifference ? recon.bankDifference.toFixed(2) : null,
  };
}
