import { PrismaClient, CategoryType, DebtStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting database seeding...");

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

  // 2. Load and validate seed credentials from environment variables
  const seedEmail = process.env.SEED_USER_EMAIL;
  const seedPassword = process.env.SEED_USER_PASSWORD;
  const seedName = process.env.SEED_USER_NAME;

  if (!seedEmail || !seedPassword || !seedName) {
    throw new Error(
      "CRITICAL SEED ERROR: Missing required seed credentials. Please configure SEED_USER_EMAIL, SEED_USER_PASSWORD, and SEED_USER_NAME in your .env file."
    );
  }

  const passwordHash = bcrypt.hashSync(seedPassword, 10);
  const user = await prisma.user.create({
    data: {
      email: seedEmail,
      passwordHash,
      name: seedName,
    },
  });
  console.log(`Created user: ${user.email}`);

  // 3. Create settings for user
  await prisma.setting.create({
    data: {
      userId: user.id,
      monthlySalary: 5750.00,
      payday: 25,
      currency: "AED",
      theme: "system",
      notificationPref: {},
    },
  });
  console.log("Created settings.");

  // 4. Create default categories
  const categoriesData = [
    // Income
    { name: "Salary", type: CategoryType.INCOME, budgetGroupKey: null },
    // Transfers
    { name: "Transfers", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
    { name: "Rent Cash", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
    // Spending
    { name: "Transportation", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
    { name: "Groceries", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: "FOOD" },
    { name: "Dining", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: "FOOD" },
    { name: "Shopping", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
    { name: "Utilities", type: CategoryType.FIXED_EXPENSE, budgetGroupKey: null },
    { name: "Uncategorized", type: CategoryType.VARIABLE_EXPENSE, budgetGroupKey: null },
    // Debt & Savings & Remittance
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
  console.log(`Seeded ${categoriesData.length} categories.`);

  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction) {
    // 5. Create budget allocations for the current month
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
      { categoryName: "Emergency Savings", amount: 400.00 },
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
          userId: user.id,
        },
      });
    }
    console.log(`Seeded budget allocations for month ${currentMonthStr}.`);

    // 6. Create debts
    await prisma.debt.create({
      data: {
        name: "Tabby",
        originalBalance: 8284.58,
        currentBalance: 8284.58,
        monthlyPayment: 500.00,
        dueDay: 25,
        rolloverFeeRate: 4.50, // 4.5%
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

    console.log("Seeded debts (Tabby and Table Tennis Equipment).");

    // 7. Seed initial Savings Goals
    await prisma.savingGoal.create({
      data: {
        name: "Emergency Fund",
        targetAmount: 10000.00,
        currentAmount: 0.00,
        categoryId: categoriesMap["Emergency Savings"],
        userId: user.id,
      },
    });
    console.log("Seeded default Savings Goals.");
  } else {
    console.log("Production environment detected: skipping seeding of budgets, debts, and savings goals. These must be configured via the Setup screen.");
  }

  // 8. Provision default accounts
  const { accountService } = await import("../src/server/services/account.service");
  await accountService.ensureDefaultAccounts(user.id);
  console.log("Seeded default accounts (Emirates NBD, Mashreq, Cash).");

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
