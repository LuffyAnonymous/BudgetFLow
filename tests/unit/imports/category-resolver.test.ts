import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import { TransactionType, CategoryType } from "@prisma/client";
import { resolveFallbackCategory } from "../../../src/imports/engine/category-resolver";

describe("resolveFallbackCategory", () => {
  let userId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "category_resolver_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: {
        email: "category_resolver_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Category Resolver Tester",
      },
    });
    userId = user.id;
  });

  it("assigns 'Rent Cash' when an EXPENSE is >=20% of the most recent income", async () => {
    const salaryCat = await db.category.create({
      data: { userId, name: "Salary", type: CategoryType.INCOME },
    });
    await db.category.create({
      data: { userId, name: "Rent Cash", type: CategoryType.FIXED_EXPENSE },
    });
    // Two eligible FIXED_EXPENSE/VARIABLE_EXPENSE categories so rule 2
    // (single-type-match) doesn't short-circuit before rule 1 is tested.
    await db.category.create({
      data: { userId, name: "Groceries", type: CategoryType.VARIABLE_EXPENSE },
    });

    await db.transaction.create({
      data: {
        userId,
        categoryId: salaryCat.id,
        date: new Date(),
        description: "Salary",
        amount: 5000,
        paymentMethod: "Bank Transfer",
        type: TransactionType.INCOME,
      },
    });

    const result = await db.$transaction((tx) =>
      resolveFallbackCategory(tx, userId, TransactionType.EXPENSE, new Decimal(1200)) // 24% of 5000
    );

    expect(result?.name).toBe("Rent Cash");
  });

  it("does not apply the salary-ratio rule below the 20% threshold", async () => {
    const salaryCat = await db.category.create({
      data: { userId, name: "Salary", type: CategoryType.INCOME },
    });
    await db.category.create({ data: { userId, name: "Rent Cash", type: CategoryType.FIXED_EXPENSE } });
    await db.category.create({ data: { userId, name: "Groceries", type: CategoryType.VARIABLE_EXPENSE } });

    await db.transaction.create({
      data: {
        userId,
        categoryId: salaryCat.id,
        date: new Date(),
        description: "Salary",
        amount: 5000,
        paymentMethod: "Bank Transfer",
        type: TransactionType.INCOME,
      },
    });

    const result = await db.$transaction((tx) =>
      resolveFallbackCategory(tx, userId, TransactionType.EXPENSE, new Decimal(500)) // 10% of 5000
    );

    // Two eligible expense categories exist, so rule 2 also can't resolve it — expect null.
    expect(result).toBeNull();
  });

  it("falls back to the single eligible category for the transaction's type", async () => {
    const onlyExpenseCat = await db.category.create({
      data: { userId, name: "Everything", type: CategoryType.VARIABLE_EXPENSE },
    });

    const result = await db.$transaction((tx) =>
      resolveFallbackCategory(tx, userId, TransactionType.EXPENSE, new Decimal(20))
    );

    expect(result?.id).toBe(onlyExpenseCat.id);
  });

  it("returns null when no rule can resolve a category", async () => {
    await db.category.create({ data: { userId, name: "Groceries", type: CategoryType.VARIABLE_EXPENSE } });
    await db.category.create({ data: { userId, name: "Rent Cash", type: CategoryType.FIXED_EXPENSE } });

    const result = await db.$transaction((tx) =>
      resolveFallbackCategory(tx, userId, TransactionType.EXPENSE, new Decimal(20))
    );

    expect(result).toBeNull();
  });

  it("applies the single-type-match rule for non-EXPENSE types too", async () => {
    const onlyDebtCat = await db.category.create({
      data: { userId, name: "Loan Payment", type: CategoryType.DEBT },
    });

    const result = await db.$transaction((tx) =>
      resolveFallbackCategory(tx, userId, TransactionType.DEBT_PAYMENT, new Decimal(300))
    );

    expect(result?.id).toBe(onlyDebtCat.id);
  });
});
