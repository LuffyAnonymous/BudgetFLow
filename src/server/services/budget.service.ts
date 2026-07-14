import { BudgetRepository } from "../repositories/budget.repository";
import { CategoryRepository } from "../repositories/category.repository";
import { TransactionRepository } from "../repositories/transaction.repository";
import { BudgetOverviewItem, CreateBudgetData } from "@/features/budgets/types/budget.types";
import { getDubaiMonthRange } from "@/lib/dates";
import { Decimal } from "decimal.js";
import { CategoryType, TransactionType, AuditAction, AuditEntityType } from "@prisma/client";
import { db } from "@/lib/db";
import { AuditLogService } from "./audit-log.service";
import {
  calculateCategoryBudgetRemaining,
  calculateBudgetProgress,
} from "../calculations/finance-calculations";

export class BudgetService {
  private budgetRepo = new BudgetRepository();
  private categoryRepo = new CategoryRepository();
  private transactionRepo = new TransactionRepository();

  /**
   * Fetches the budget overview items for a specific month YYYY-MM.
   */
  async getBudgetOverview(userId: string, month: string): Promise<BudgetOverviewItem[]> {
    // 1. Fetch categories, budgets and transactions
    const categories = await this.categoryRepo.findManyByUserId(userId);
    const budgets = await this.budgetRepo.findManyByMonth(userId, month);
    
    const { start, nextMonthStart } = getDubaiMonthRange(month);
    const transactions = await this.transactionRepo.findManyInRange(userId, start, nextMonthStart);

    // 2. Reconcile categories
    const overview: BudgetOverviewItem[] = [];

    for (const category of categories) {
      const budget = budgets.find((b) => b.categoryId === category.id);
      const planned = budget ? budget.amount : new Decimal(0);
      
      let actual = new Decimal(0);

      // Reconcile actual spend based on compatibility rules
      if (category.budgetGroupKey === "FOOD") {
        // Only sum food transactions for the designated Food category to prevent double counting
        // We choose the primary "Food" category that has a budget or default to name check
        const isPrimaryFood = budget && budget.amount.gt(0) || category.name === "Food";
        
        if (isPrimaryFood) {
          const foodCatIds = categories
            .filter((c) => c.budgetGroupKey === "FOOD")
            .map((c) => c.id);
            
          const foodTx = transactions.filter(
            (t) => foodCatIds.includes(t.categoryId) && t.type === TransactionType.EXPENSE
          );
          
          actual = foodTx.reduce((sum, t) => sum.plus(t.amount), new Decimal(0));
        } else {
          // Individual child food rows (like Groceries and Dining Out) report 0 actual spent
          // as their values roll up to the parent Food category.
          actual = new Decimal(0);
        }
      } else {
        // Normal expenses: sum category transaction expense amounts
        if (
          category.type === CategoryType.FIXED_EXPENSE ||
          category.type === CategoryType.VARIABLE_EXPENSE
        ) {
          const matchTx = transactions.filter(
            (t) => t.categoryId === category.id && t.type === TransactionType.EXPENSE
          );
          actual = matchTx.reduce((sum, t) => sum.plus(t.amount), new Decimal(0));
        } else {
          // Savings, Debt, Remittance actuals are 0 in Milestone 2
          actual = new Decimal(0);
        }
      }

      const remaining = calculateCategoryBudgetRemaining(planned, actual);
      const progressPercent = calculateBudgetProgress(actual, planned);
      
      const status = this.determineBudgetStatus(actual, planned);

      overview.push({
        id: budget?.id,
        categoryId: category.id,
        categoryName: category.name,
        categoryType: category.type,
        budgetGroupKey: category.budgetGroupKey,
        planned: planned.toFixed(2),
        actual: actual.toFixed(2),
        remaining: remaining.toFixed(2),
        progressPercent: progressPercent.toFixed(2),
        status,
      });
    }

    return overview;
  }

  /**
   * Upsert a monthly budget with transactional audit logging.
   */
  async upsertBudget(userId: string, data: CreateBudgetData) {
    // Verify category ownership
    const category = await this.categoryRepo.findByIdAndUserId(data.categoryId, userId);
    if (!category) {
      throw new Error("INVALID_CATEGORY: Selected category not found.");
    }

    // Check for existing (to distinguish create vs update in audit)
    const existing = await this.budgetRepo.findByCategoryAndMonth(userId, data.categoryId, data.month);

    return db.$transaction(async (tx) => {
      const upserted = await this.budgetRepo.upsertWithTx(tx, userId, data);
      await AuditLogService.log(
        {
          userId,
          action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
          entityType: AuditEntityType.BUDGET,
          entityId: upserted.id,
          before: existing ? { amount: existing.amount.toString() } : null,
          after: { amount: upserted.amount.toString(), month: upserted.month, categoryId: upserted.categoryId },
        },
        tx
      );
      return upserted;
    });
  }

  /**
   * Delete a monthly budget. Scopes deletion to budget id & user id.
   * Note: Deleting the budget plan leaves categories & transactions intact.
   */
  async deleteBudget(id: string, userId: string) {
    const existing = await this.budgetRepo.findById(id, userId);
    if (!existing) {
      throw new Error("BUDGET_NOT_FOUND: The selected budget was not found.");
    }
    return this.budgetRepo.delete(id, userId);
  }

  /**
   * Copy budgets from a source month to a target month.
   */
  async copyPreviousMonthBudgets(userId: string, sourceMonth: string, targetMonth: string) {
    return this.budgetRepo.copyBudgets(userId, sourceMonth, targetMonth);
  }

  /**
   * Classify status according to standard Decimal comparisons.
   */
  private determineBudgetStatus(
    actual: Decimal,
    planned: Decimal
  ): "ON_TRACK" | "NEAR_LIMIT" | "OVER_BUDGET" | "COMPLETED" {
    if (planned.isZero()) {
      return actual.isZero() ? "ON_TRACK" : "OVER_BUDGET";
    }

    if (actual.eq(planned)) {
      return "COMPLETED";
    }

    if (actual.gt(planned)) {
      return "OVER_BUDGET";
    }

    const threshold = planned.mul(0.8);
    if (actual.gte(threshold)) {
      return "NEAR_LIMIT";
    }

    return "ON_TRACK";
  }
}
