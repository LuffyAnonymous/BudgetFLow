import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export class ReportRepository {
  async getTransactions(userId: string, startDate?: Date, endDate?: Date) {
    const where: Prisma.TransactionWhereInput = { userId };
    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lt = endDate;
      where.date = dateFilter;
    }
    return db.transaction.findMany({
      where,
      include: { category: true },
      orderBy: { date: "asc" },
    });
  }

  async getBudgets(userId: string, month?: string) {
    const where: Prisma.BudgetWhereInput = { userId };
    if (month) {
      where.month = month;
    }
    return db.budget.findMany({
      where,
      include: { category: true },
    });
  }

  async getDebtPayments(userId: string, startDate?: Date, endDate?: Date) {
    const where: Prisma.DebtPaymentWhereInput = { userId };
    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lt = endDate;
      where.paymentDate = dateFilter;
    }
    return db.debtPayment.findMany({
      where,
      include: { debt: true },
      orderBy: { paymentDate: "asc" },
    });
  }

  async getSavingTransactions(userId: string, startDate?: Date, endDate?: Date) {
    const where: Prisma.SavingTransactionWhereInput = { userId };
    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lt = endDate;
      where.transactionDate = dateFilter;
    }
    return db.savingTransaction.findMany({
      where,
      include: { savingGoal: true },
      orderBy: { transactionDate: "asc" },
    });
  }

  async getRemittances(userId: string, startDate?: Date, endDate?: Date) {
    const where: Prisma.RemittanceWhereInput = { userId };
    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lt = endDate;
      where.transferDate = dateFilter;
    }
    return db.remittance.findMany({
      where,
      include: { category: true },
      orderBy: { transferDate: "asc" },
    });
  }

  async getDebts(userId: string) {
    return db.debt.findMany({
      where: { userId },
    });
  }

  async getSavingGoals(userId: string) {
    return db.savingGoal.findMany({
      where: { userId },
    });
  }
}
