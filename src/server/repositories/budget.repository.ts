import { db } from "@/lib/db";
import { Budget, Prisma } from "@prisma/client";
import { CreateBudgetData } from "@/features/budgets/types/budget.types";
import { parseCanonicalMonth } from "@/lib/dates";

export class BudgetRepository {
  /**
   * Fetches all budget allocations for a given user and month (YYYY-MM).
   */
  async findManyByMonth(userId: string, month: string): Promise<Budget[]> {
    return db.budget.findMany({
      where: { userId, month },
      include: {
        category: true,
      },
    });
  }

  /**
   * Find budget by category and month.
   */
  async findByCategoryAndMonth(
    userId: string,
    categoryId: string,
    month: string
  ): Promise<Budget | null> {
    return db.budget.findFirst({
      where: { userId, categoryId, month },
      include: {
        category: true,
      },
    });
  }

  /**
   * Find budget by ID and userId.
   */
  async findById(id: string, userId: string): Promise<Budget | null> {
    return db.budget.findFirst({
      where: { id, userId },
      include: {
        category: true,
      },
    });
  }

  /**
   * Upsert a monthly budget. Scopes unique constraints by userId, categoryId, and month.
   */
  async upsert(userId: string, data: CreateBudgetData): Promise<Budget> {
    // Validate canonical month
    parseCanonicalMonth(data.month);

    return db.budget.upsert({
      where: {
        userId_categoryId_month: {
          userId,
          categoryId: data.categoryId,
          month: data.month,
        },
      },
      update: {
        amount: data.amount,
      },
      create: {
        userId,
        categoryId: data.categoryId,
        amount: data.amount,
        month: data.month,
      },
      include: {
        category: true,
      },
    });
  }

  /**
   * Upsert inside an existing Prisma transaction context.
   */
  async upsertWithTx(tx: Prisma.TransactionClient, userId: string, data: CreateBudgetData): Promise<Budget> {
    parseCanonicalMonth(data.month);

    return tx.budget.upsert({
      where: {
        userId_categoryId_month: {
          userId,
          categoryId: data.categoryId,
          month: data.month,
        },
      },
      update: { amount: data.amount },
      create: {
        userId,
        categoryId: data.categoryId,
        amount: data.amount,
        month: data.month,
      },
      include: { category: true },
    });
  }

  /**
   * Deletes a monthly budget. Scoped to ID and userId.
   */
  async delete(id: string, userId: string): Promise<Budget> {
    const existing = await db.budget.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new Error("Budget not found or unauthorized");
    }

    return db.budget.delete({
      where: { id, userId },
    });
  }

  /**
   * Copies budget records from a source month to a target month atomically.
   */
  async copyBudgets(
    userId: string,
    sourceMonth: string,
    targetMonth: string
  ): Promise<{ copiedCount: number }> {
    if (sourceMonth === targetMonth) {
      throw new Error("Source and target months must be different.");
    }

    // Validate inputs
    parseCanonicalMonth(sourceMonth);
    parseCanonicalMonth(targetMonth);

    return db.$transaction(async (tx) => {
      // 1. Check if target month already has budgets
      const targetCount = await tx.budget.count({
        where: { userId, month: targetMonth },
      });
      if (targetCount > 0) {
        throw new Error("Target month already contains budget configurations.");
      }

      // 2. Fetch source budgets
      const sourceBudgets = await tx.budget.findMany({
        where: { userId, month: sourceMonth },
      });
      if (sourceBudgets.length === 0) {
        throw new Error("Source month contains no budgets to copy.");
      }

      // 3. Map and insert copy records (only copy userId, categoryId, amount, month)
      const dataToInsert: Prisma.BudgetCreateManyInput[] = sourceBudgets.map((b) => ({
        userId,
        categoryId: b.categoryId,
        amount: b.amount,
        month: targetMonth,
      }));

      const result = await tx.budget.createMany({
        data: dataToInsert,
      });

      return { copiedCount: result.count };
    });
  }
}
