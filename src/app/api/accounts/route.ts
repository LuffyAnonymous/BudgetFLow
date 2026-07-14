import { auth } from "@/auth";
import { accountService } from "@/server/services/account.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view accounts.", 401);
    }

    const accounts = await accountService.getAccounts(session.user.id);
    const serializedAccounts = await Promise.all(
      accounts.map(async (acc) => {
        const recon = await accountService.reconcileAccountBalance(session.user.id, acc.id);
        return {
          id: acc.id,
          type: acc.type,
          name: acc.name,
          currentBalance: acc.currentBalance.toFixed(2),
          latestImportedBalance: acc.latestImportedBalance ? acc.latestImportedBalance.toFixed(2) : null,
          lastSMSImported: acc.lastSMSImportedAt ? acc.lastSMSImportedAt.toISOString() : null,
          lastSuccessfulSync: acc.lastSuccessfulSyncAt ? acc.lastSuccessfulSyncAt.toISOString() : null,
          reconciliationStatus: recon.reconciliationStatus,
          cacheDifference: recon.cacheDifference.toFixed(2),
          bankDifference: recon.bankDifference ? recon.bankDifference.toFixed(2) : null,
        };
      })
    );

    return apiSuccess(serializedAccounts);
  } catch (error) {
    return handleApiError(error);
  }
}
