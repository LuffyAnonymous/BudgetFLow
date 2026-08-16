/**
 * tests/e2e/global-setup.ts
 *
 * Playwright global setup — runs once before all tests.
 *
 * Resets the E2E database to a clean state, then seeds the E2E test user,
 * categories, debts, and provisions default accounts.
 */

import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { provisionNewUser } from "../../src/server/services/user-provisioning.service";

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
    // Base account: user, settings, generic categories, and default accounts
    // all come from the same path a real sign-up goes through.
    const user = await provisionNewUser(
      {
        email: "e2e@budgetflow.test",
        name: "E2E Test User",
        passwordHash: createHash("sha256").update("e2epassword123").digest("hex"),
      },
      prisma
    );
    await prisma.setting.update({
      where: { userId: user.id },
      data: { monthlySalary: 5750, payday: 26 },
    });
    console.log("[e2e:globalSetup] E2E test user provisioned:", user.id);

    // This suite additionally exercises two personal debts, which need
    // their own categories beyond the generic set provisionNewUser creates.
    const tabbyCategory = await prisma.category.create({
      data: { name: "Tabby Payment", type: "DEBT", userId: user.id },
    });
    const tableTennisCategory = await prisma.category.create({
      data: { name: "Table Tennis Payment", type: "DEBT", userId: user.id },
    });
    console.log("[e2e:globalSetup] Seeded personal E2E categories.");

    // Create default debts
    await prisma.debt.create({
      data: {
        name: "Tabby",
        originalBalance: 8284.58,
        currentBalance: 8284.58,
        monthlyPayment: 500.00,
        dueDay: 25,
        rolloverFeeRate: 4.50,
        categoryId: tabbyCategory.id,
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
        categoryId: tableTennisCategory.id,
        userId: user.id,
      },
    });
    console.log("[e2e:globalSetup] Seeded default E2E debts.");
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
