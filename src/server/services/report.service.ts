import { ReportRepository } from "../repositories/report.repository";
import { Decimal } from "decimal.js";
import { RemittanceStatus, TransactionType, CashFlowDirection, SavingTxType } from "@prisma/client";

export interface MonthlyReportData {
  month: string; // YYYY-MM
  income: string;
  expense: string;
  netCashFlow: string;
  spendingByCategory: { categoryName: string; amount: string; type: string }[];
  budgetVsActual: {
    categoryName: string;
    budgeted: string;
    actual: string;
    difference: string;
  }[];
  remittances: {
    grossAmountSent: string;
    reversedAmount: string;
    netAmountSent: string;
    grossFees: string;
    reversedFees: string;
    netFees: string;
    grossPhpReceived: string;
    reversedPhp: string;
    netPhpReceived: string;
  };
  debts: {
    totalPayments: string;
  };
  savings: {
    totalDeposits: string;
    totalWithdrawals: string;
  };
}

export interface TrendReportData {
  months: {
    month: string; // YYYY-MM
    income: string;
    expense: string;
    netCashFlow: string;
    debtBalance: string;
    savingsBalance: string;
    remittanceSent: string;
  }[];
}

export class ReportService {
  private reportRepo = new ReportRepository();

  /**
   * Helper to format a Date object as YYYY-MM in Dubai local time (Asia/Dubai)
   */
  private getDubaiYearMonth(date: Date): string {
    const d = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Dubai" }));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  /**
   * Safe cash flow sign determination based on explicit direction & legacy fallback
   */
  private isTransactionInflow(tx: { type: TransactionType; cashFlowDirection: CashFlowDirection | null }): boolean {
    if (tx.cashFlowDirection === CashFlowDirection.INFLOW) {
      return true;
    }
    if (tx.cashFlowDirection === CashFlowDirection.OUTFLOW) {
      return false;
    }
    // Legacy null direction fallback
    return tx.type === TransactionType.INCOME;
  }

  /**
   * Generate monthly financial aggregates for a single YYYY-MM month
   */
  async getMonthlyReport(userId: string, monthStr: string): Promise<MonthlyReportData> {
    const regex = /^\d{4}-\d{2}$/;
    if (!regex.test(monthStr)) {
      throw new Error("INVALID_MONTH_FORMAT: Month must be in YYYY-MM format.");
    }

    // Determine start and end date boundaries in UTC for the given Dubai month
    const [year, month] = monthStr.split("-").map(Number);
    
    // Start of the month at 00:00:00 local Dubai time
    const startDate = new Date(
      new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00`).toLocaleString("en-US", {
        timeZone: "Asia/Dubai",
      })
    );
    
    // End of the month (start of next month exclusive)
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endDate = new Date(
      new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00`).toLocaleString("en-US", {
        timeZone: "Asia/Dubai",
      })
    );

    // Fetch datasets from repository
    const transactions = await this.reportRepo.getTransactions(userId, startDate, endDate, monthStr);
    const budgets = await this.reportRepo.getBudgets(userId, monthStr);
    const remittances = await this.reportRepo.getRemittances(userId, startDate, endDate);
    const debtPayments = await this.reportRepo.getDebtPayments(userId, startDate, endDate);
    const savingTransactions = await this.reportRepo.getSavingTransactions(userId, startDate, endDate);

    // 1. Cash flow aggregates
    let income = new Decimal(0);
    let expense = new Decimal(0);

    transactions.forEach((tx) => {
      const isInflow = this.isTransactionInflow(tx);
      if (isInflow) {
        income = income.add(tx.amount);
      } else {
        expense = expense.add(tx.amount);
      }
    });

    // 2. Spending by category
    const categorySpendingMap: Record<string, { amount: Decimal; type: string }> = {};
    transactions.forEach((tx) => {
      const isInflow = this.isTransactionInflow(tx);
      // Skip income from outgoing category reports, or include it?
      // Ordinarily category spending maps expense details
      if (!isInflow) {
        const catName = tx.category.name;
        if (!categorySpendingMap[catName]) {
          categorySpendingMap[catName] = { amount: new Decimal(0), type: tx.category.type };
        }
        categorySpendingMap[catName].amount = categorySpendingMap[catName].amount.add(tx.amount);
      }
    });

    const spendingByCategory = Object.entries(categorySpendingMap).map(([categoryName, data]) => ({
      categoryName,
      amount: data.amount.toFixed(2),
      type: data.type,
    }));

    // 3. Budget vs Actual
    // Group actual spending by categoryId for the month
    const actualSpendingMap: Record<string, Decimal> = {};
    transactions.forEach((tx) => {
      const isInflow = this.isTransactionInflow(tx);
      if (!isInflow) {
        actualSpendingMap[tx.categoryId] = (actualSpendingMap[tx.categoryId] || new Decimal(0)).add(tx.amount);
      }
    });

    const budgetVsActual = budgets.map((b) => {
      const actual = actualSpendingMap[b.categoryId] || new Decimal(0);
      const budgeted = b.amount;
      return {
        categoryName: b.category.name,
        budgeted: budgeted.toFixed(2),
        actual: actual.toFixed(2),
        difference: budgeted.sub(actual).toFixed(2), // positive means under budget, negative means over budget
      };
    });

    // 4. Remittances totals
    let grossAmountSent = new Decimal(0);
    let reversedAmount = new Decimal(0);
    let grossFees = new Decimal(0);
    let reversedFees = new Decimal(0);
    let grossPhpReceived = new Decimal(0);
    let reversedPhp = new Decimal(0);

    remittances.forEach((r) => {
      grossAmountSent = grossAmountSent.add(r.amountSentAed);
      if (r.transferFeeAed) {
        grossFees = grossFees.add(r.transferFeeAed);
      }
      if (r.amountReceivedPhp) {
        grossPhpReceived = grossPhpReceived.add(r.amountReceivedPhp);
      }

      if (r.status === RemittanceStatus.REVERSED) {
        reversedAmount = reversedAmount.add(r.amountSentAed);
        if (r.transferFeeAed) {
          reversedFees = reversedFees.add(r.transferFeeAed);
        }
        if (r.amountReceivedPhp) {
          reversedPhp = reversedPhp.add(r.amountReceivedPhp);
        }
      }
    });

    // 5. Debt payments total
    let totalPayments = new Decimal(0);
    debtPayments.forEach((p) => {
      totalPayments = totalPayments.add(p.amount);
    });

    // 6. Savings totals
    let totalDeposits = new Decimal(0);
    let totalWithdrawals = new Decimal(0);
    savingTransactions.forEach((tx) => {
      if (tx.type === SavingTxType.DEPOSIT) {
        totalDeposits = totalDeposits.add(tx.amount);
      } else {
        totalWithdrawals = totalWithdrawals.add(tx.amount);
      }
    });

    return {
      month: monthStr,
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      netCashFlow: income.sub(expense).toFixed(2),
      spendingByCategory,
      budgetVsActual,
      remittances: {
        grossAmountSent: grossAmountSent.toFixed(2),
        reversedAmount: reversedAmount.toFixed(2),
        netAmountSent: grossAmountSent.sub(reversedAmount).toFixed(2),
        grossFees: grossFees.toFixed(2),
        reversedFees: reversedFees.toFixed(2),
        netFees: grossFees.sub(reversedFees).toFixed(2),
        grossPhpReceived: grossPhpReceived.toFixed(2),
        reversedPhp: reversedPhp.toFixed(2),
        netPhpReceived: grossPhpReceived.sub(reversedPhp).toFixed(2),
      },
      debts: {
        totalPayments: totalPayments.toFixed(2),
      },
      savings: {
        totalDeposits: totalDeposits.toFixed(2),
        totalWithdrawals: totalWithdrawals.toFixed(2),
      },
    };
  }

  /**
   * Reconstruct historical trend reports over a series of months (max 24)
   */
  async getTrendsReport(userId: string, fromMonth: string, toMonth: string): Promise<TrendReportData> {
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(fromMonth) || !monthRegex.test(toMonth)) {
      throw new Error("INVALID_MONTH_FORMAT: Dates must be in YYYY-MM format.");
    }

    const [fromYear, fromMonthNum] = fromMonth.split("-").map(Number);
    const [toYear, toMonthNum] = toMonth.split("-").map(Number);

    // Calculate count of months
    const startVal = fromYear * 12 + (fromMonthNum - 1);
    const endVal = toYear * 12 + (toMonthNum - 1);
    const monthCount = endVal - startVal + 1;

    if (monthCount <= 0) {
      throw new Error("INVALID_RANGE: Start month must be prior to or equal to end month.");
    }
    if (monthCount > 24) {
      throw new Error("RANGE_EXCEEDED: Maximum trend range is 24 months.");
    }

    // Generate list of months in YYYY-MM format
    const monthsList: string[] = [];
    for (let i = 0; i < monthCount; i++) {
      const curVal = startVal + i;
      const y = Math.floor(curVal / 12);
      const m = (curVal % 12) + 1;
      monthsList.push(`${y}-${String(m).padStart(2, "0")}`);
    }

    // Fetch broad datasets to aggregate in memory (safer for small-to-medium datasets)
    const startDate = new Date(new Date(`${fromYear}-${String(fromMonthNum).padStart(2, "0")}-01T00:00:00`).toLocaleString("en-US", { timeZone: "Asia/Dubai" }));
    
    const nextToMonth = toMonthNum === 12 ? 1 : toMonthNum + 1;
    const nextToYear = toMonthNum === 12 ? toYear + 1 : toYear;
    const endDate = new Date(new Date(`${nextToYear}-${String(nextToMonth).padStart(2, "0")}-01T00:00:00`).toLocaleString("en-US", { timeZone: "Asia/Dubai" }));

    const transactions = await this.reportRepo.getTransactions(userId, startDate, endDate);
    const remittances = await this.reportRepo.getRemittances(userId, startDate, endDate);
    const allDebts = await this.reportRepo.getDebts(userId);
    const allSavingGoals = await this.reportRepo.getSavingGoals(userId);

    // Fetch all historical snapshots for balance trend reconstruction
    const allDebtPayments = await this.reportRepo.getDebtPayments(userId);
    const allSavingTransactions = await this.reportRepo.getSavingTransactions(userId);

    // Pre-group transactions by month
    const cashFlowByMonth: Record<string, { income: Decimal; expense: Decimal }> = {};
    const remittanceSentByMonth: Record<string, Decimal> = {};

    monthsList.forEach((m) => {
      cashFlowByMonth[m] = { income: new Decimal(0), expense: new Decimal(0) };
      remittanceSentByMonth[m] = new Decimal(0);
    });

    transactions.forEach((tx) => {
      const mStr = tx.budgetMonth || this.getDubaiYearMonth(tx.date);
      if (cashFlowByMonth[mStr]) {
        const isInflow = this.isTransactionInflow(tx);
        if (isInflow) {
          cashFlowByMonth[mStr].income = cashFlowByMonth[mStr].income.add(tx.amount);
        } else {
          cashFlowByMonth[mStr].expense = cashFlowByMonth[mStr].expense.add(tx.amount);
        }
      }
    });

    remittances.forEach((r) => {
      const mStr = this.getDubaiYearMonth(r.transferDate);
      if (remittanceSentByMonth[mStr] && r.status === RemittanceStatus.COMPLETED) {
        remittanceSentByMonth[mStr] = remittanceSentByMonth[mStr].add(r.amountSentAed);
      }
    });

    // 1. Debt balance reconstruction
    const debtBalancesByMonth: Record<string, Decimal> = {};
    monthsList.forEach((m) => {
      debtBalancesByMonth[m] = new Decimal(0);
    });

    allDebts.forEach((debt: { id: string; currentBalance: Decimal }) => {
      const debtPayments = allDebtPayments.filter((p) => p.debtId === debt.id);

      monthsList.forEach((monthStr) => {
        // Find latest payment in this month
        const paymentsInMonth = debtPayments.filter((p) => this.getDubaiYearMonth(p.paymentDate) === monthStr);
        if (paymentsInMonth.length > 0) {
          // Sort by paymentDate asc, then createdAt asc, get latest
          paymentsInMonth.sort((a, b) => {
            const dateDiff = a.paymentDate.getTime() - b.paymentDate.getTime();
            if (dateDiff !== 0) return dateDiff;
            return a.createdAt.getTime() - b.createdAt.getTime();
          });
          const latestPayment = paymentsInMonth[paymentsInMonth.length - 1];
          debtBalancesByMonth[monthStr] = debtBalancesByMonth[monthStr].add(latestPayment.balanceAfter);
        } else {
          // No payments in this month. Find the earliest payment AFTER this month.
          const paymentsAfter = debtPayments.filter((p) => this.getDubaiYearMonth(p.paymentDate) > monthStr);
          if (paymentsAfter.length > 0) {
            paymentsAfter.sort((a, b) => {
              const dateDiff = a.paymentDate.getTime() - b.paymentDate.getTime();
              if (dateDiff !== 0) return dateDiff;
              return a.createdAt.getTime() - b.createdAt.getTime();
            });
            const earliestPaymentAfter = paymentsAfter[0];
            debtBalancesByMonth[monthStr] = debtBalancesByMonth[monthStr].add(earliestPaymentAfter.balanceBefore);
          } else {
            // No payments after this month either -> uses current balance!
            debtBalancesByMonth[monthStr] = debtBalancesByMonth[monthStr].add(debt.currentBalance);
          }
        }
      });
    });

    // 2. Savings balance reconstruction
    const savingsBalancesByMonth: Record<string, Decimal> = {};
    monthsList.forEach((m) => {
      savingsBalancesByMonth[m] = new Decimal(0);
    });

    allSavingGoals.forEach((goal: { id: string; currentAmount: Decimal }) => {
      const goalTxs = allSavingTransactions.filter((t) => t.savingGoalId === goal.id);

      monthsList.forEach((monthStr) => {
        const txsInMonth = goalTxs.filter((t) => this.getDubaiYearMonth(t.transactionDate) === monthStr);
        if (txsInMonth.length > 0) {
          txsInMonth.sort((a, b) => {
            const dateDiff = a.transactionDate.getTime() - b.transactionDate.getTime();
            if (dateDiff !== 0) return dateDiff;
            return a.createdAt.getTime() - b.createdAt.getTime();
          });
          const latestTx = txsInMonth[txsInMonth.length - 1];
          savingsBalancesByMonth[monthStr] = savingsBalancesByMonth[monthStr].add(latestTx.balanceAfter);
        } else {
          const txsAfter = goalTxs.filter((t) => this.getDubaiYearMonth(t.transactionDate) > monthStr);
          if (txsAfter.length > 0) {
            txsAfter.sort((a, b) => {
              const dateDiff = a.transactionDate.getTime() - b.transactionDate.getTime();
              if (dateDiff !== 0) return dateDiff;
              return a.createdAt.getTime() - b.createdAt.getTime();
            });
            const earliestTxAfter = txsAfter[0];
            savingsBalancesByMonth[monthStr] = savingsBalancesByMonth[monthStr].add(earliestTxAfter.balanceBefore);
          } else {
            savingsBalancesByMonth[monthStr] = savingsBalancesByMonth[monthStr].add(goal.currentAmount);
          }
        }
      });
    });

    // Format output
    const monthsData = monthsList.map((m) => {
      const cf = cashFlowByMonth[m];
      return {
        month: m,
        income: cf.income.toFixed(2),
        expense: cf.expense.toFixed(2),
        netCashFlow: cf.income.sub(cf.expense).toFixed(2),
        debtBalance: debtBalancesByMonth[m].toFixed(2),
        savingsBalance: savingsBalancesByMonth[m].toFixed(2),
        remittanceSent: remittanceSentByMonth[m].toFixed(2),
      };
    });

    return { months: monthsData };
  }
}
