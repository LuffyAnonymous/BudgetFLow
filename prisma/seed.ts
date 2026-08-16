import { PrismaClient, CategoryType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { provisionNewUser } from "../src/server/services/user-provisioning.service";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting database seeding...");

  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    // 1. Clean existing data (in reverse order of dependencies)
    await prisma.setting.deleteMany({});
    await prisma.savingTransaction.deleteMany({});
    await prisma.savingGoal.deleteMany({});
    await prisma.debtPayment.deleteMany({});
    await prisma.debt.deleteMany({});
    await prisma.remittance.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.budget.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.user.deleteMany({});
    console.log("Cleared existing data.");
  } else {
    console.log("Production environment detected: skipping database clearance.");
  }

  // 2. Load and validate seed credentials from environment variables
  const seedEmail = process.env.SEED_USER_EMAIL;
  const seedPassword = process.env.SEED_USER_PASSWORD;
  const seedName = process.env.SEED_USER_NAME;

  if (!seedEmail || !seedPassword || !seedName) {
    throw new Error(
      "CRITICAL SEED ERROR: Missing required seed credentials. Please configure SEED_USER_EMAIL, SEED_USER_PASSWORD, and SEED_USER_NAME in your .env file."
    );
  }

  const normalizedEmail = seedEmail.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  let userId: string;
  if (existingUser) {
    // Re-run against an already-provisioned account: just refresh credentials.
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { name: seedName, passwordHash },
    });
    userId = existingUser.id;
    console.log(`Updated existing seed user: ${normalizedEmail}`);
  } else {
    // Fresh account: default categories, settings, and accounts all come from
    // the same provisioning path a real sign-up goes through.
    const provisioned = await provisionNewUser(
      { email: normalizedEmail, passwordHash, name: seedName },
      prisma
    );
    userId = provisioned.id;
    console.log(`Seeded user via provisionNewUser: ${normalizedEmail}`);
  }

  // Idempotent regardless of branch above — ensures accounts exist even on a re-run.
  const { accountService } = await import("../src/server/services/account.service");
  await accountService.ensureDefaultAccounts(userId);

  // Personalize the salary amount/payday for this specific demo account
  // (provisionNewUser leaves monthlySalary at 0 for generic new users).
  await prisma.setting.update({
    where: { userId },
    data: { monthlySalary: 5750.0, payday: 25 },
  });

  // Enable the import engine by default for the seeded admin account.
  await prisma.importSetting.upsert({
    where: { userId },
    create: { userId, enabled: true, senderAllowlist: ["ENBD"] },
    update: { enabled: true, senderAllowlist: ["ENBD"] },
  });
  console.log("Seeded import settings (enabled: true) for admin.");

  // 3. This demo account additionally tracks two personal debts, which need
  // their own categories beyond the generic set provisionNewUser creates.
  const personalCategories = [
    { name: "Tabby Payment", type: CategoryType.DEBT, budgetGroupKey: null },
    { name: "Table Tennis Payment", type: CategoryType.DEBT, budgetGroupKey: null },
  ];
  for (const cat of personalCategories) {
    await prisma.category.upsert({
      where: { userId_name: { userId, name: cat.name } },
      update: { type: cat.type, budgetGroupKey: cat.budgetGroupKey },
      create: { userId, name: cat.name, type: cat.type, budgetGroupKey: cat.budgetGroupKey },
    });
  }

  const categories = await prisma.category.findMany({ where: { userId } });
  const categoriesMap: Record<string, string> = {};
  categories.forEach((c) => { categoriesMap[c.name] = c.id; });
  console.log(`${categories.length} categories present for seed user.`);

  if (!isProduction) {
    // 4. Create budget allocations for the current month
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const currentMonthStr = `${year}-${month}`; // YYYY-MM

    const budgetsData = [
      { categoryName: "Rent Cash", amount: 2000.00 },
      { categoryName: "Transportation", amount: 400.00 },
      { categoryName: "Tabby Payment", amount: 500.00 },
      { categoryName: "Table Tennis Payment", amount: 150.00 },
      { categoryName: "Groceries", amount: 900.00 },
      { categoryName: "Remittance", amount: 700.00 },
      { categoryName: "Savings", amount: 400.00 },
    ];

    for (const budget of budgetsData) {
      const categoryId = categoriesMap[budget.categoryName];
      if (!categoryId) {
        console.warn(`Category not found: ${budget.categoryName}`);
        continue;
      }
      await prisma.budget.create({
        data: {
          categoryId,
          amount: budget.amount,
          month: currentMonthStr,
          userId,
        },
      });
    }
    console.log(`Seeded budget allocations for month ${currentMonthStr}.`);

    // 5. Create debts
    await prisma.debt.create({
      data: {
        name: "Tabby",
        originalBalance: 8284.58,
        currentBalance: 8284.58,
        monthlyPayment: 500.00,
        dueDay: 25,
        rolloverFeeRate: 4.50, // 4.5%
        categoryId: categoriesMap["Tabby Payment"],
        userId,
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
        userId,
      },
    });

    console.log("Seeded debts (Tabby and Table Tennis Equipment).");

    // 6. Seed initial Savings Goal
    await prisma.savingGoal.create({
      data: {
        name: "Emergency Fund",
        targetAmount: 10000.00,
        currentAmount: 0.00,
        categoryId: categoriesMap["Savings"],
        userId,
      },
    });
    console.log("Seeded default Savings Goals.");
  } else {
    console.log("Production environment detected: skipping seeding of budgets, debts, and savings goals. These must be configured via the Setup screen.");
  }

  console.log("Seeding complete successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
