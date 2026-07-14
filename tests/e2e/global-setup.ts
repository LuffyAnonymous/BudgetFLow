/**
 * tests/e2e/global-setup.ts
 *
 * Playwright global setup — runs once before all tests.
 *
 * Resets the E2E database to a clean state, then seeds the E2E test user,
 * categories, debts, and provisions default accounts.
 */

import { execSync } from "child_process";
import { PrismaClient, CategoryType, AccountType } from "@prisma/client";
import { createHash } from "crypto";
import { accountService } from "../../src/server/services/account.service";

const E2E_DATABASE_URL =
  process.env.DATABASE_URL_E2E ??
  "postgresql://postgres:postgres@localhost:5435/budgetflow_e2e?schema=public";

async function globalSetup() {
  console.log("\n[e2e:globalSetup] Resetting E2E database…");

  try {
    execSync("npx tsx scripts/reset-e2e-database.ts", {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL_E2E: E2E_DATABASE_URL,
      },
    });
    console.log("[e2e:globalSetup] Database reset complete.");
  } catch (err) {
    console.error("[e2e:globalSetup] Database reset FAILED:", err);
    throw err;
  }

  // Seed E2E test user (always after reset)
  const prisma = new PrismaClient({
    datasources: { db: { url: E2E_DATABASE_URL } },
  });

  try {
    const user = await prisma.user.create({
      data: {
        email: "e2e@budgetflow.test",
        name: "E2E Test User",
        passwordHash: createHash("sha256").update("e2epassword123").digest("hex"),
        settings: {
          create: {
            monthlySalary: 5750,
            payday: 26,
            currency: "AED",
          },
        },
      },
    });

    console.log("[e2e:globalSetup] E2E test user seeded:", user.id);

    // Create default categories for E2E tests
    const categoriesData = [
      { name: "Salary", type: CategoryType.INCOME, budgetGroupKey: null },
      { name: "Transfers", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
      { name: "Rent Cash", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
      { name: "Transportation", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
      { name: "Groceries", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: "FOOD" },
      { name: "Dining", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: "FOOD" },
      { name: "Shopping", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
      { name: "Utilities", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
      { name: "Uncategorized", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
      { name: "Tabby Payment", type: CategoryType.DEBT, budgetGroupKey: null },
      { name: "Table Tennis Payment", type: CategoryType.DEBT, budgetGroupKey: null },
      { name: "Emergency Savings", type: CategoryType.SAVINGS, budgetGroupKey: null },
      { name: "Remittance", type: CategoryType.REMITTANCE, budgetGroupKey: null },
    ];

    const categoriesMap: Record<string, string> = {};
    for (const cat of categoriesData) {
      const createdCat = await prisma.category.create({
        data: {
          name: cat.name,
          type: cat.type,
          budgetGroupKey: cat.budgetGroupKey,
          userId: user.id,
        },
      });
      categoriesMap[cat.name] = createdCat.id;
    }
    console.log("[e2e:globalSetup] Seeded default E2E categories.");

    // Create default debts
    await prisma.debt.create({
      data: {
        name: "Tabby",
        originalBalance: 8284.58,
        currentBalance: 8284.58,
        monthlyPayment: 500.00,
        dueDay: 25,
        rolloverFeeRate: 4.50,
        categoryId: categoriesMap["Tabby Payment"],
        userId: user.id,
      },
    });

    await prisma.debt.create({
      data: {
        name: "Table Tennis Equipment",
        originalBalance: 600.00,
        currentBalance: 600.00,
        monthlyPayment: 150.00,
        dueDay: 15,
        rolloverFeeRate: 0.00,
        categoryId: categoriesMap["Table Tennis Payment"],
        userId: user.id,
      },
    });
    console.log("[e2e:globalSetup] Seeded default E2E debts.");

    // Provision default accounts using AccountService (uses E2E DB Client under transaction helper or direct prisma Client)
    const mockService = new (require("../../src/server/services/account.service").AccountService)();
    // Inject E2E client into mockService
    mockService.getClient = () => prisma;
    await mockService.ensureDefaultAccounts(user.id);
    console.log("[e2e:globalSetup] Seeded default E2E accounts.");

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[e2e:globalSetup] Failed to seed test user context:", msg);
    throw err;
  } finally {
    await prisma.$disconnect();
  }

  console.log("[e2e:globalSetup] Setup complete.\n");
}

export default globalSetup;
