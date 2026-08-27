import { auth } from "@/auth";
import { db } from "@/lib/db";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";
import { DebtStatus, SavingGoalStatus } from "@prisma/client";
import { Decimal } from "decimal.js";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to perform setup.", 401);
    }
    const userId = session.user.id;
    const body = await request.json();

    const {
      tabbyBalance,
      tableTennisBalance,
      salaryCategoryId,
      payday,
      foodBudget,
      nolBudget,
      savingsTarget,
      safetyBuffer,
      senderAllowlist,
    } = body;

    // Fetch categories to match named categories
    const categories = await db.category.findMany({ where: { userId } });
    const categoriesMap: Record<string, string> = {};
    categories.forEach((c) => {
      categoriesMap[c.name] = c.id;
    });

    const activeMonthStr = (() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      return `${year}-${month}`;
    })();

    await db.$transaction(async (tx) => {
      // 1. Update settings
      await tx.setting.upsert({
        where: { userId },
        create: {
          userId,
          monthlySalary: new Decimal("0.00"),
          payday: payday ? parseInt(payday, 10) : 25,
          currency: "AED",
          theme: "system",
          notificationPref: {
            safeDailyThreshold: safetyBuffer ? parseFloat(safetyBuffer) : 50.0,
            upcomingPaymentsEnabled: true,
            overduePaymentsEnabled: true,
            budgetAlertsEnabled: true,
            savingsAlertsEnabled: true,
            rolloverAlertsEnabled: true,
          },
        },
        update: {
          payday: payday ? parseInt(payday, 10) : 25,
          notificationPref: {
            safeDailyThreshold: safetyBuffer ? parseFloat(safetyBuffer) : 50.0,
            upcomingPaymentsEnabled: true,
            overduePaymentsEnabled: true,
            budgetAlertsEnabled: true,
            savingsAlertsEnabled: true,
            rolloverAlertsEnabled: true,
          },
        },
      });

      // 2. Update Import settings
      const finalSalaryCategoryId = salaryCategoryId || categoriesMap["Salary"];
      await tx.importSetting.upsert({
        where: { userId },
        create: {
          userId,
          enabled: true,
          senderAllowlist: senderAllowlist ? senderAllowlist.split(",").map((s: string) => s.trim()) : ["ENBD"],
          salaryCategoryId: finalSalaryCategoryId || null,
        },
        update: {
          enabled: true,
          senderAllowlist: senderAllowlist ? senderAllowlist.split(",").map((s: string) => s.trim()) : ["ENBD"],
          salaryCategoryId: finalSalaryCategoryId || null,
        },
      });

      // 3. Create Budgets
      if (foodBudget) {
        const foodCatId = categoriesMap["Groceries"] || categoriesMap["Dining"];
        if (foodCatId) {
          await tx.budget.upsert({
            where: { userId_categoryId_month: { userId, categoryId: foodCatId, month: activeMonthStr } },
            create: { userId, categoryId: foodCatId, month: activeMonthStr, amount: new Decimal(foodBudget) },
            update: { amount: new Decimal(foodBudget) },
          });
        }
      }

      if (nolBudget) {
        const transportCatId = categoriesMap["Transportation"];
        if (transportCatId) {
          await tx.budget.upsert({
            where: { userId_categoryId_month: { userId, categoryId: transportCatId, month: activeMonthStr } },
            create: { userId, categoryId: transportCatId, month: activeMonthStr, amount: new Decimal(nolBudget) },
            update: { amount: new Decimal(nolBudget) },
          });
        }
      }

      // Add emergency savings budget if provided
      const emergencySavingsCatId = categoriesMap["Emergency Savings"];
      if (emergencySavingsCatId) {
        await tx.budget.upsert({
          where: { userId_categoryId_month: { userId, categoryId: emergencySavingsCatId, month: activeMonthStr } },
          create: { userId, categoryId: emergencySavingsCatId, month: activeMonthStr, amount: new Decimal("400.00") },
          update: { amount: new Decimal("400.00") },
        });
      }

      // 4. Create Debts
      if (tabbyBalance && parseFloat(tabbyBalance) > 0) {
        const tabbyPaymentCatId = categoriesMap["Tabby Payment"];
        await tx.debt.create({
          data: {
            userId,
            name: "Tabby",
            originalBalance: new Decimal(tabbyBalance),
            currentBalance: new Decimal(tabbyBalance),
            monthlyPayment: new Decimal("500.00"),
            dueDay: 25,
            rolloverFeeRate: new Decimal("4.50"),
            status: DebtStatus.ACTIVE,
            categoryId: tabbyPaymentCatId || null,
          },
        });
      }

      if (tableTennisBalance && parseFloat(tableTennisBalance) > 0) {
        const ttPaymentCatId = categoriesMap["Table Tennis Payment"];
        await tx.debt.create({
          data: {
            userId,
            name: "Table Tennis Equipment",
            originalBalance: new Decimal(tableTennisBalance),
            currentBalance: new Decimal(tableTennisBalance),
            monthlyPayment: new Decimal("150.00"),
            dueDay: 15,
            rolloverFeeRate: new Decimal("0.00"),
            status: DebtStatus.ACTIVE,
            categoryId: ttPaymentCatId || null,
          },
        });
      }

      // 5. Create Savings Goal
      if (savingsTarget) {
        const savingsCatId = categoriesMap["Emergency Savings"];
        await tx.savingGoal.create({
          data: {
            userId,
            name: "Emergency Fund",
            targetAmount: new Decimal(savingsTarget),
            currentAmount: new Decimal(0),
            status: SavingGoalStatus.ACTIVE,
            categoryId: savingsCatId || null,
          },
        });
      }
    });

    return apiSuccess({ message: "Setup completed successfully." });
  } catch (error) {
    return handleApiError(error);
  }
}
