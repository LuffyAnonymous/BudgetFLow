/**
 * src/server/services/user-provisioning.service.ts
 *
 * Single source of truth for what a brand-new BudgetFlow account gets:
 * the default category set, an empty settings row, and default accounts
 * (Emirates NBD + Cash). Used by POST /api/auth/register, prisma/seed.ts,
 * and the E2E test harness, so onboarding never drifts out of sync across
 * the three places a user previously got created.
 */

// No "server-only" guard here (unlike most services under src/server/services) —
// this module is also imported directly from plain-Node contexts: prisma/seed.ts
// and tests/e2e/global-setup.ts, both run via tsx outside the Next.js bundler.

import { CategoryType, type Prisma, type PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { accountService } from "./account.service";

export const DEFAULT_CATEGORIES: { name: string; type: CategoryType; budgetGroupKey: string | null }[] = [
  // Income
  { name: "Salary", type: CategoryType.INCOME, budgetGroupKey: null },
  // Transfers / fixed expenses
  { name: "Transfers", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
  { name: "Rent Cash", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
  { name: "Utilities", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
  // Variable expenses
  { name: "Transportation", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
  { name: "Groceries", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: "FOOD" },
  { name: "Dining", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: "FOOD" },
  { name: "Shopping", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
  { name: "Uncategorized", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
  // Debt / savings / remittance
  { name: "Debt Payments", type: CategoryType.DEBT, budgetGroupKey: null },
  { name: "Savings", type: CategoryType.SAVINGS, budgetGroupKey: null },
  { name: "Remittance", type: CategoryType.REMITTANCE, budgetGroupKey: null },
];

export interface ProvisionNewUserInput {
  email: string;
  passwordHash: string;
  name: string;
}

export interface ProvisionedUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Creates a User plus everything it needs to be immediately usable:
 * default categories, a blank settings row (monthlySalary starts at 0 —
 * the user fills it in via Settings or the /setup wizard), and the
 * default accounts. Runs in a single transaction so a failure never
 * leaves a half-provisioned account behind.
 *
 * Accepts an optional `client` for callers that must target a non-default
 * database (e.g. the E2E test harness, which points at an isolated DB via
 * its own PrismaClient rather than the app's ambient DATABASE_URL).
 */
export async function provisionNewUser(
  input: ProvisionNewUserInput,
  client: PrismaClient = db
): Promise<ProvisionedUser> {
  const user = await client.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        name: input.name,
      },
    });

    await tx.setting.create({
      data: {
        userId: createdUser.id,
        monthlySalary: 0,
        payday: 25,
        currency: "AED",
        theme: "system",
        notificationPref: {},
      },
    });

    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((cat) => ({
        userId: createdUser.id,
        name: cat.name,
        type: cat.type,
        budgetGroupKey: cat.budgetGroupKey,
      })),
    });

    await accountService.ensureDefaultAccounts(createdUser.id, tx as Prisma.TransactionClient);

    return createdUser;
  });

  return { id: user.id, email: user.email, name: user.name };
}
