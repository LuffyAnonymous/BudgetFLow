import { Decimal } from "decimal.js";
import { TransactionType, CashFlowDirection, TransactionOrigin } from "@prisma/client";

export interface CreateTransactionData {
  date: Date;
  budgetMonth?: string | null;
  categoryId: string;
  description: string;
  amount: Decimal;
  paymentMethod: string;
  notes?: string | null;
  type: TransactionType;
  cashFlowDirection?: CashFlowDirection | null;
  origin?: TransactionOrigin;
  accountId?: string | null;
  toAccountId?: string | null;
}

export interface UpdateTransactionData {
  date?: Date;
  budgetMonth?: string | null;
  categoryId?: string;
  description?: string;
  amount?: Decimal;
  paymentMethod?: string;
  notes?: string | null;
  type?: TransactionType;
  cashFlowDirection?: CashFlowDirection | null;
  origin?: TransactionOrigin;
  accountId?: string | null;
  toAccountId?: string | null;
}

export interface TransactionFilters {
  search?: string;
  categoryId?: string;
  type?: TransactionType;
  startDate?: Date;
  endDate?: Date;
  budgetMonth?: string;
  page?: number;
  pageSize?: number;
}
