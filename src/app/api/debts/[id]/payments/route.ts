import { auth } from "@/auth";
import { resolveRequestAuth } from "@/lib/service-auth";
import { DebtService } from "@/server/services/debt.service";
import { recordPaymentSchema } from "@/features/debts/schemas/debt.schema";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const debtService = new DebtService();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to view payments.", 401);
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "10", 10);

    const result = await debtService.getPayments(session.user.id, {
      debtId: id,
      page,
      pageSize,
    });

    const serializedItems = result.items.map((payment) => ({
      id: payment.id,
      debtId: payment.debtId,
      amount: payment.amount.toFixed(2),
      balanceBefore: payment.balanceBefore.toFixed(2),
      balanceAfter: payment.balanceAfter.toFixed(2),
      paymentDate: payment.paymentDate.toISOString(),
      notes: payment.notes,
      transactionId: payment.transactionId,
      transactionStatus: payment.transactionId ? "LINKED" : "UNLINKED",
      createdAt: payment.createdAt.toISOString(),
    }));

    return apiSuccess({
      items: serializedItems,
      page: result.page,
      pageSize: result.pageSize,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await resolveRequestAuth(request, "debts:write");
    if (!authResult) {
      return apiError("UNAUTHORIZED", "You must be signed in, or provide a service API key with debts:write scope, to record a payment.", 401);
    }
    const userId = authResult.userId;

    const { id } = await params;
    const body = await request.json();
    const validationResult = recordPaymentSchema.safeParse(body);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues[0]?.message || "Validation failed";
      return apiError("VALIDATION_ERROR", errorMsg, 400);
    }

    const valData = validationResult.data;
    const payment = await debtService.recordDebtPayment(userId, id, valData);

    return apiSuccess({
      id: payment.id,
      debtId: payment.debtId,
      amount: payment.amount.toFixed(2),
      balanceBefore: payment.balanceBefore.toFixed(2),
      balanceAfter: payment.balanceAfter.toFixed(2),
      paymentDate: payment.paymentDate.toISOString(),
      notes: payment.notes,
      transactionId: payment.transactionId,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
