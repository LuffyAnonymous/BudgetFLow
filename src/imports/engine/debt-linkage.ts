import { Prisma, CategoryType, CashFlowDirection, DebtStatus, NotificationType, NotificationSeverity } from "@prisma/client";
import { Decimal } from "decimal.js";
import { DebtService } from "@/server/services/debt.service";
import { matchDebtByDescription } from "./debt-matcher";

const debtService = new DebtService();

interface LedgerTxForDebtLinkage {
  id: string;
  amount: Decimal | number | string;
  date: Date;
  categoryId: string;
  description: string;
}

/**
 * Matches a just-created outgoing transaction against the user's debts —
 * either by category (an existing debt-linked category, e.g. "Tabby
 * Payment") or by payee name (a personal transfer matching a debt's
 * registered payeeAliases, e.g. "Ahmed Ali") — and auto-applies it as a
 * DebtPayment if found. Best-effort: never throws, so a linkage failure
 * (balance exceeded, race, etc.) never blocks the underlying transaction
 * from posting.
 */
export async function tryApplyDebtLinkage(
  tx: Prisma.TransactionClient,
  userId: string,
  ledgerTx: LedgerTxForDebtLinkage,
  cashFlowDirection: CashFlowDirection
): Promise<void> {
  if (cashFlowDirection === CashFlowDirection.INFLOW) return;

  let matchedDebt: { id: string; name: string } | null = null;

  const category = await tx.category.findUnique({ where: { id: ledgerTx.categoryId } });
  if (category && category.type === CategoryType.DEBT) {
    matchedDebt = await tx.debt.findFirst({
      where: { userId, categoryId: ledgerTx.categoryId, status: DebtStatus.ACTIVE },
      select: { id: true, name: true },
    });
  }

  if (!matchedDebt) {
    const candidates = await tx.debt.findMany({
      where: { userId, status: DebtStatus.ACTIVE, payeeAliases: { isEmpty: false } },
      select: { id: true, name: true, payeeAliases: true },
    });
    matchedDebt = matchDebtByDescription(candidates, ledgerTx.description);
  }

  if (!matchedDebt) return;

  try {
    const payment = await debtService.recordDebtPayment(
      userId,
      matchedDebt.id,
      {
        amount: ledgerTx.amount,
        paymentDate: ledgerTx.date,
        notes: `Auto-applied from transaction: ${ledgerTx.description}`,
        existingTransactionId: ledgerTx.id,
      },
      tx
    );

    const setting = await tx.setting.findUnique({ where: { userId }, select: { currency: true } });
    const currency = setting?.currency ?? "AED";
    const amountStr = new Decimal(ledgerTx.amount).toFixed(2);

    if (new Decimal(payment.balanceAfter).isZero()) {
      await tx.notification.create({
        data: {
          userId,
          type: NotificationType.DEBT_PAID_OFF,
          severity: NotificationSeverity.INFO,
          title: "Debt Paid Off!",
          message: `You have successfully paid off your debt: ${matchedDebt.name}.`,
          eventKey: `debt-paid-${matchedDebt.id}-${ledgerTx.id}`,
          relatedEntityType: "Debt",
          relatedEntityId: matchedDebt.id,
          destinationPath: "/debts",
        },
      });
    } else {
      await tx.notification.create({
        data: {
          userId,
          type: NotificationType.DEBT_PAYMENT_AUTO_APPLIED,
          severity: NotificationSeverity.INFO,
          title: "Debt payment applied",
          message: `${currency} ${amountStr} from "${ledgerTx.description}" was automatically applied to ${matchedDebt.name}.`,
          eventKey: `debt-payment-applied-${payment.id}`,
          relatedEntityType: "Debt",
          relatedEntityId: matchedDebt.id,
          destinationPath: "/debts",
        },
      });
    }
  } catch (err) {
    console.warn(
      "[debt-linkage] Skipped auto-applying payment:",
      err instanceof Error ? err.message : err
    );
  }
}
