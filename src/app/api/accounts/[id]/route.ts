import { resolveRequestAuth } from "@/lib/service-auth";
import { accountService } from "@/server/services/account.service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { serializeAccountWithReconciliation } from "../serialize-account";
import { z } from "zod";

const UpdateAccountSchema = z.object({
  isPrimary: z.literal(true),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await resolveRequestAuth(request, "accounts:write");
    if (!authResult) {
      return apiError("UNAUTHORIZED", "You must be signed in, or provide a service API key with accounts:write scope, to update an account.", 401);
    }
    const userId = authResult.userId;
    const { id } = await params;

    const body = await request.json();
    const parsed = UpdateAccountSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", "Only { isPrimary: true } is supported — set a different account as primary instead of unsetting this one.", 400);
    }

    await accountService.setPrimaryAccount(userId, id);

    const accounts = await accountService.getAccounts(userId);
    const serializedAccounts = await Promise.all(
      accounts.map((acc) => serializeAccountWithReconciliation(userId, acc))
    );

    return apiSuccess(serializedAccounts);
  } catch (error) {
    return handleApiError(error);
  }
}
