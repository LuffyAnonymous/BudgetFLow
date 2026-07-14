import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Decimal } from "@prisma/client/runtime/library";

const MAX_PER_MODULE = 5;

function decimalToNumber(val: Decimal | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  return Number(val);
}

/**
 * GET /api/search?q=<query>
 *
 * Performs a full-text keyword search across:
 * - Transactions (description, notes)
 * - Budgets (categoryName)
 * - Debts (creditorName, notes)
 * - Savings (goalName, notes)
 * - Remittances (recipient, transferProvider, notes)
 * - Categories (name)
 * - Recurring Templates (name, description)
 *
 * Returns max 5 results per module.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (!q || q.length < 2) {
    return NextResponse.json({ results: {} });
  }

  const userId = session.user.id;
  const ilike = { contains: q, mode: "insensitive" as const };

  const [transactions, budgets, debts, savings, remittances, categories, recurringTemplates] =
    await Promise.all([
      db.transaction.findMany({
        where: {
          userId,
          OR: [{ description: ilike }, { notes: ilike }],
        },
        orderBy: { date: "desc" },
        take: MAX_PER_MODULE,
        select: {
          id: true,
          description: true,
          amount: true,
          type: true,
          date: true,
          category: { select: { name: true } },
        },
      }),

      db.budget.findMany({
        where: {
          userId,
          category: { name: ilike },
        },
        take: MAX_PER_MODULE,
        select: {
          id: true,
          month: true,
          amount: true,
          category: { select: { name: true } },
        },
      }),

      db.debt.findMany({
        where: {
          userId,
          OR: [{ name: ilike }, { notes: ilike }],
        },
        take: MAX_PER_MODULE,
        select: {
          id: true,
          name: true,
          currentBalance: true,
          status: true,
        },
      }),

      db.savingGoal.findMany({
        where: {
          userId,
          OR: [{ name: ilike }, { notes: ilike }],
        },
        take: MAX_PER_MODULE,
        select: {
          id: true,
          name: true,
          targetAmount: true,
          currentAmount: true,
          status: true,
        },
      }),

      db.remittance.findMany({
        where: {
          userId,
          OR: [{ recipient: ilike }, { transferProvider: ilike }, { notes: ilike }],
        },
        orderBy: { transferDate: "desc" },
        take: MAX_PER_MODULE,
        select: {
          id: true,
          recipient: true,
          amountSentAed: true,
          transferProvider: true,
          status: true,
          transferDate: true,
        },
      }),

      db.category.findMany({
        where: {
          userId,
          name: ilike,
        },
        take: MAX_PER_MODULE,
        select: { id: true, name: true, type: true },
      }),

      db.recurringTemplate.findMany({
        where: {
          userId,
          name: ilike,
        },
        take: MAX_PER_MODULE,
        select: {
          id: true,
          name: true,
          notes: true,
          frequency: true,
          status: true,
          amount: true,
        },
      }),
    ]);

  return NextResponse.json({
    query: q,
    results: {
      transactions: transactions.map((t: typeof transactions[number]) => ({
        ...t,
        amount: decimalToNumber(t.amount),
        date: t.date.toISOString(),
      })),
      budgets: budgets.map((b: typeof budgets[number]) => ({
        ...b,
        amount: decimalToNumber(b.amount),
      })),
      debts: debts.map((d: typeof debts[number]) => ({
        ...d,
        currentBalance: decimalToNumber(d.currentBalance),
      })),
      savings: savings.map((s: typeof savings[number]) => ({
        ...s,
        targetAmount: decimalToNumber(s.targetAmount),
        currentAmount: decimalToNumber(s.currentAmount),
      })),
      remittances: remittances.map((r: typeof remittances[number]) => ({
        ...r,
        amountSentAed: decimalToNumber(r.amountSentAed),
        transferDate: r.transferDate.toISOString(),
      })),
      categories,
      recurringTemplates: recurringTemplates.map((rt: typeof recurringTemplates[number]) => ({
        ...rt,
        amount: decimalToNumber(rt.amount),
      })),
    },
  });
}
