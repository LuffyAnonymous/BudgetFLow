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
   * Auto-allocates a monthly budget plan for `budgetMonth` from that month's
   * total Salary income. Fires whenever a Salary-category transaction is
   * created (see TransactionService.createTransaction), regardless of import
   * channel, so it stays in sync with early-salary budgetMonth attribution
   * (src/lib/salary-month.ts) automatically.
   *
   * Fixed costs (rent, recreation) and percentages (savings, remittance) are
   * user-specified constants below — edit these if the user's real numbers
   * change. Debt categories get their real Debt.monthlyPayment amounts,
   * matched by debt name where a same-named category exists, else pooled
   * into the generic "Debt Payment" category. What's left splits across the
   * remaining variable-expense categories by fixed relative weights.
   *
   * No-op if there's no Salary category, no salary income for this month, or
   * a required category is missing (never throws — this is a best-effort
   * convenience, not a blocker for transaction creation).
   */
  async autoAllocateFromSalary(userId: string, budgetMonth: string): Promise<void> {
    const categories = await this.categoryRepo.findManyByUserId(userId);
    const findCat = (predicate: (c: (typeof categories)[number]) => boolean) =>
      categories.find(predicate);

    const salaryCategory = findCat(
      (c) => c.type === CategoryType.INCOME && c.name.toLowerCase() === "salary"
    );
    if (!salaryCategory) return;

    const salaryTxs = await db.transaction.findMany({
      where: {
        userId,
        categoryId: salaryCategory.id,
        type: TransactionType.INCOME,
        budgetMonth,
      },
    });
    const totalSalary = salaryTxs.reduce((sum, t) => sum.plus(t.amount), new Decimal(0));
    if (totalSalary.lte(0)) return;

    // --- User-specified fixed amounts and rates (2026-08 baseline) ---
    const RENT_AMOUNT = new Decimal(2000);
    const RECREATION_AMOUNT = new Decimal(220);
    const SAVINGS_RATE = new Decimal("0.10");
    const REMITTANCE_RATE = new Decimal("0.10");
    const DEBT_NAME_TO_CATEGORY_NAME: Record<string, string> = {
      tabby: "tabby payment",
      "table tennis equipment": "table tennis payment",
    };
    const LIVING_EXPENSE_WEIGHTS: Array<{ category: string; weight: number }> = [
      { category: "groceries", weight: 20 },
      { category: "dining", weight: 12 },
      { category: "transportation", weight: 10 },
      { category: "utilities", weight: 8 },
      { category: "shopping", weight: 5 },
    ];

    const savingsAmount = totalSalary.mul(SAVINGS_RATE);
    const remittanceAmount = totalSalary.mul(REMITTANCE_RATE);

    // --- Active debts -> per-category allocation (real monthlyPayment amounts) ---
    const activeDebts = await db.debt.findMany({ where: { userId, status: "ACTIVE" } });
    const debtAllocationByCategoryId = new Map<string, Decimal>();
    let matchedDebtTotal = new Decimal(0);

    for (const debt of activeDebts) {
      const guessName = DEBT_NAME_TO_CATEGORY_NAME[debt.name.trim().toLowerCase()];
      const targetCategory =
        (guessName &&
          findCat((c) => c.type === CategoryType.DEBT && c.name.toLowerCase() === guessName)) ||
        findCat((c) => c.type === CategoryType.DEBT && c.name.toLowerCase() === "debt payment");
      if (!targetCategory) continue;

      const prev = debtAllocationByCategoryId.get(targetCategory.id) ?? new Decimal(0);
      debtAllocationByCategoryId.set(targetCategory.id, prev.plus(debt.monthlyPayment));
      matchedDebtTotal = matchedDebtTotal.plus(debt.monthlyPayment);
    }

    const fixedTotal = RENT_AMOUNT.plus(RECREATION_AMOUNT)
      .plus(matchedDebtTotal)
      .plus(savingsAmount)
      .plus(remittanceAmount);
    const remaining = Decimal.max(0, totalSalary.minus(fixedTotal));

    // --- Split remaining across living-expense categories by relative weight ---
    const totalWeight = LIVING_EXPENSE_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
    const livingAllocations: Array<{ categoryId: string; amount: Decimal }> = [];
    let allocatedSoFar = new Decimal(0);

    LIVING_EXPENSE_WEIGHTS.forEach((entry, idx) => {
      const cat = findCat((c) => c.name.toLowerCase() === entry.category);
      if (!cat) return;

      const isLast = idx === LIVING_EXPENSE_WEIGHTS.length - 1;
      // Last category absorbs the rounding remainder so the total is exact.
      const amount = isLast
        ? remaining.minus(allocatedSoFar)
        : remaining.mul(entry.weight).div(totalWeight).toDecimalPlaces(2);
      if (!isLast) allocatedSoFar = allocatedSoFar.plus(amount);

      livingAllocations.push({ categoryId: cat.id, amount });
    });

    // --- Assemble every budget row to write ---
    const upserts: Array<{ categoryId: string; amount: Decimal }> = [
      { categoryId: salaryCategory.id, amount: totalSalary },
    ];

    const rentCategory = findCat((c) => c.name.toLowerCase() === "rent cash");
    if (rentCategory) upserts.push({ categoryId: rentCategory.id, amount: RENT_AMOUNT });

    const recreationCategory = findCat((c) => c.name.toLowerCase() === "recreation");
    if (recreationCategory) {
      upserts.push({ categoryId: recreationCategory.id, amount: RECREATION_AMOUNT });
    }

    const savingsCategory = findCat(
      (c) => c.type === CategoryType.SAVINGS && c.name.toLowerCase() === "emergency savings"
    );
    if (savingsCategory) upserts.push({ categoryId: savingsCategory.id, amount: savingsAmount });

    const remittanceCategory = findCat((c) => c.type === CategoryType.REMITTANCE);
    if (remittanceCategory) {
      upserts.push({ categoryId: remittanceCategory.id, amount: remittanceAmount });
    }

    for (const [categoryId, amount] of debtAllocationByCategoryId) {
      upserts.push({ categoryId, amount });
    }

    upserts.push(...livingAllocations);

    for (const u of upserts) {
      await this.upsertBudget(userId, { categoryId: u.categoryId, amount: u.amount, month: budgetMonth });
    }
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
