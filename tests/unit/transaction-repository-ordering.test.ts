import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { TransactionRepository } from "@/server/repositories/transaction.repository";

const repo = new TransactionRepository();

/**
 * Regression test for a real production bug: `date` is midnight-truncated
 * (Dubai-local calendar day), so two transactions posted on the same day
 * previously had an undefined relative order in the Transactions list —
 * a later withdrawal could appear above an earlier salary credit even
 * though the salary genuinely happened first. Fixed by adding
 * Transaction.occurredAt (full real-world precision) and sorting by it.
 */
describe("TransactionRepository.findMany ordering", () => {
  let userId: string;
  let categoryId: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.category.deleteMany({});
    await db.user.deleteMany({ where: { email: "tx_ordering_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "tx_ordering_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Ordering Tester" },
    });
    userId = user.id;

    const category = await db.category.create({ data: { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" } });
    categoryId = category.id;
  });

  it("orders same-day transactions by occurredAt, not by insertion/createdAt order", async () => {
    const sameDay = new Date("2026-08-29T00:00:00.000Z"); // midnight-truncated `date`

    // Salary genuinely happened first in the real world (09:00), but gets
    // *inserted* into the DB second (simulating a backfill/resync where
    // processing order doesn't match real event order).
    const salaryOccurredAt = new Date("2026-08-29T09:00:00.000Z");
    const withdrawalOccurredAt = new Date("2026-08-29T16:57:00.000Z");

    const withdrawal = await db.transaction.create({
      data: {
        userId, categoryId, date: sameDay, occurredAt: withdrawalOccurredAt,
        description: "ATM Withdrawal", amount: 3500, paymentMethod: "Email Import",
        type: "EXPENSE", cashFlowDirection: "OUTFLOW", origin: "EMAIL_IMPORT",
      },
    });
    const salary = await db.transaction.create({
      data: {
        userId, categoryId, date: sameDay, occurredAt: salaryOccurredAt,
        description: "Salary", amount: 5750, paymentMethod: "Email Import",
        type: "INCOME", cashFlowDirection: "INFLOW", origin: "EMAIL_IMPORT",
      },
    });

    const results = await repo.findMany(userId, { page: 1, pageSize: 10 });

    // Newest-first by real event time: withdrawal (16:57) before salary (09:00),
    // regardless of which row was actually inserted first.
    expect(results.map((r) => r.id)).toEqual([withdrawal.id, salary.id]);
  });

  it("falls back to date/createdAt ordering when occurredAt happens to be null (defensive — shouldn't occur in practice)", async () => {
    const day1 = new Date("2026-08-28T00:00:00.000Z");
    const day2 = new Date("2026-08-29T00:00:00.000Z");

    const older = await db.transaction.create({
      data: {
        userId, categoryId, date: day1, occurredAt: null,
        description: "Older", amount: 10, paymentMethod: "Manual",
        type: "EXPENSE", cashFlowDirection: "OUTFLOW", origin: "MANUAL",
      },
    });
    const newer = await db.transaction.create({
      data: {
        userId, categoryId, date: day2, occurredAt: null,
        description: "Newer", amount: 20, paymentMethod: "Manual",
        type: "EXPENSE", cashFlowDirection: "OUTFLOW", origin: "MANUAL",
      },
    });

    const results = await repo.findMany(userId, { page: 1, pageSize: 10 });
    expect(results.map((r) => r.id)).toEqual([newer.id, older.id]);
  });
});
