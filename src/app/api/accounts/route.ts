import { resolveRequestAuth } from "@/lib/service-auth";
import { accountService } from "@/server/services/account.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { serializeAccountWithReconciliation } from "./serialize-account";

export async function GET(request: Request) {
  try {
    const authResult = await resolveRequestAuth(request, "accounts:read");
    if (!authResult) {
      return apiError("UNAUTHORIZED", "You must be signed in, or provide a service API key with accounts:read scope, to view accounts.", 401);
    }
    const userId = authResult.userId;

    const accounts = await accountService.getAccounts(userId);
    const serializedAccounts = await Promise.all(
      accounts.map((acc) => serializeAccountWithReconciliation(userId, acc))
    );

    return apiSuccess(serializedAccounts);
  } catch (error) {
    return handleApiError(error);
  }
}
