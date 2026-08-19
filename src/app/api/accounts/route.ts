import { resolveRequestAuth } from "@/lib/service-auth";
import { accountService } from "@/server/services/account.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const authResult = await resolveRequestAuth(request, "accounts:read");
    if (!authResult) {
      return apiError("UNAUTHORIZED", "You must be signed in, or provide a service API key with accounts:read scope, to view accounts.", 401);
    }
    const userId = authResult.userId;

    const accounts = await accountService.getAccounts(userId);
    const serializedAccounts = await Promise.all(
      accounts.map(async (acc) => {
        const recon = await accountService.reconcileAccountBalance(userId, acc.id);
        return {
          id: acc.id,
          type: acc.type,
          name: acc.name,
          isCreditCard: acc.isCreditCard,
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
