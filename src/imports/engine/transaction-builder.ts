import { Decimal } from "decimal.js";
import { CashFlowDirection, ImportSource, TransactionType, TransactionOrigin } from "@prisma/client";
import type { NormalizedSmsTransaction } from "../sms/sms-parser.interface";

export interface ImportTransactionData {
  date: Date;
  categoryId: string;
  description: string;
  amount: Decimal;
  paymentMethod: string;
  notes: string | null;
  type: TransactionType;
  cashFlowDirection: CashFlowDirection | null;
  importSource: ImportSource;
  origin: TransactionOrigin;
  accountId: string | null;
  toAccountId: string | null;
}

export function buildImportTransactionData(
  normalized: NormalizedSmsTransaction,
  categoryId: string,
  overrides?: {
    type?: TransactionType;
    accountId?: string | null;
    toAccountId?: string | null;
  }
): ImportTransactionData {
  // Enforce types based on overrides or defaults
  let type = overrides?.type;
  if (!type) {
    type = normalized.transactionType === "INCOME"
      ? TransactionType.INCOME
      : TransactionType.EXPENSE;
  }

  // cashFlowDirection is INFLOW for INCOME, OUTFLOW for EXPENSE, and null/optional for others (like TRANSFER)
  let cashFlowDirection: CashFlowDirection | null = null;
  if (type === TransactionType.INCOME) {
    cashFlowDirection = CashFlowDirection.INFLOW;
  } else if (type === TransactionType.EXPENSE || type === TransactionType.DEBT_PAYMENT || type === TransactionType.REMITTANCE) {
    cashFlowDirection = CashFlowDirection.OUTFLOW;
  }

  const notes = [
    `Institution: ${normalized.institution}`,
    normalized.reference ? `Reference: ${normalized.reference}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    date: normalized.transactionDate,
    categoryId,
    description: normalized.description,
    amount: new Decimal(normalized.amount.toFixed(2)),
    paymentMethod: "SMS Import",
    notes: notes || null,
    type,
    cashFlowDirection,
    importSource: ImportSource.SMS,
    origin: TransactionOrigin.SMS_IMPORT,
    accountId: overrides?.accountId || null,
    toAccountId: overrides?.toAccountId || null,
  };
}
