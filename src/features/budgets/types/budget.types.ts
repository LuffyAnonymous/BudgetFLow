import { Decimal } from "decimal.js";
import { CategoryType } from "@prisma/client";

export interface CreateBudgetData {
  categoryId: string;
  amount: Decimal;
  month: string; // YYYY-MM
}

export interface UpdateBudgetData {
  amount: Decimal;
}

export interface BudgetOverviewItem {
  id?: string; // Budget ID if configured
  categoryId: string;
  categoryName: string;
  categoryType: CategoryType;
  budgetGroupKey: string | null;
  planned: string; // serialized Decimal
  actual: string; // serialized Decimal
  remaining: string; // serialized Decimal
  progressPercent: string; // serialized Decimal
  status: "ON_TRACK" | "NEAR_LIMIT" | "OVER_BUDGET" | "COMPLETED";
}
