/**
 * src/imports/engine/category-resolver.ts
 *
 * Secondary categorization pass, used when merchant-keyword matching
 * (merchant-categorizer.ts) can't confidently name a category. Ported from
 * the n8n "02 - Processing / Categorize Transaction" workflow's "Compute
 * Category" node so bank-message ingestion keeps this logic regardless of
 * which pipeline (n8n relay or the Telegram/Shortcut path) received the
 * message.
 *
 * Two rules, tried in order:
 *   1. Salary-ratio: an EXPENSE whose amount is >=20% of the user's most
 *      recent income (last 45 days) is very likely a big fixed cost — file
 *      it under a category named "Rent Cash", if the user has one.
 *   2. Single-type match: if exactly one of the user's categories matches
 *      the transaction's type, it's an unambiguous choice, not a guess.
 *
 * Returns null if neither rule applies — callers fall through to their
 * existing literal "Uncategorized" lookup.
 */

import "server-only";

import { CategoryType, TransactionType, type Prisma } from "@prisma/client";
import type { Decimal } from "decimal.js";

const BIG_EXPENSE_RATIO = 0.2;
const BIG_EXPENSE_CATEGORY_NAME = "Rent Cash";
const RECENT_INCOME_WINDOW_DAYS = 45;

const TYPE_MAP: Record<TransactionType, CategoryType[]> = {
  [TransactionType.INCOME]: [CategoryType.INCOME],
  [TransactionType.EXPENSE]: [CategoryType.VARIABLE_EXPENSE, CategoryType.FIXED_EXPENSE],
  [TransactionType.SAVINGS]: [CategoryType.SAVINGS],
  [TransactionType.DEBT_PAYMENT]: [CategoryType.DEBT],
  [TransactionType.REMITTANCE]: [CategoryType.REMITTANCE],
  [TransactionType.TRANSFER]: [CategoryType.VARIABLE_EXPENSE, CategoryType.FIXED_EXPENSE],
};

export interface ResolvedCategory {
  id: string;
  name: string;
}

// A merchant-categorizer label (e.g. "Buy Now Pay Later") is a generic
// bucket name — it won't exist verbatim for a user who named their own
// category something more specific ("Tabby Payment", "BNPL", etc). Rather
// than only ever matching the literal label, try known aliases before
// falling through to "Uncategorized".
const CATEGORY_NAME_ALIASES: Partial<Record<string, string[]>> = {
  "Buy Now Pay Later": ["tabby", "tamara", "bnpl", "buy now pay later", "postpay", "afterpay"],
};

export async function resolveCategoryByAlias(
  tx: Prisma.TransactionClient,
  userId: string,
  categoryName: string
): Promise<ResolvedCategory | null> {
  const aliases = CATEGORY_NAME_ALIASES[categoryName];
  if (!aliases) return null;

  const candidates = await tx.category.findMany({
    where: { userId },
    select: { id: true, name: true },
  });

  for (const alias of aliases) {
    const match = candidates.find((c) => c.name.toLowerCase().includes(alias));
    if (match) return match;
  }
  return null;
}

export async function resolveFallbackCategory(
  tx: Prisma.TransactionClient,
  userId: string,
  transactionType: TransactionType,
  amount: Decimal
): Promise<ResolvedCategory | null> {
  // Rule 1: salary-ratio big-expense detection (EXPENSE only)
  if (transactionType === TransactionType.EXPENSE && amount.greaterThan(0)) {
    const windowStart = new Date(Date.now() - RECENT_INCOME_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recentIncome = await tx.transaction.findFirst({
      where: { userId, type: TransactionType.INCOME, date: { gte: windowStart } },
      orderBy: { date: "desc" },
      select: { amount: true },
    });

    if (recentIncome && recentIncome.amount.greaterThan(0)) {
      const ratio = amount.dividedBy(recentIncome.amount);
      if (ratio.greaterThanOrEqualTo(BIG_EXPENSE_RATIO)) {
        const bigExpenseCategory = await tx.category.findFirst({
          where: { userId, name: { equals: BIG_EXPENSE_CATEGORY_NAME, mode: "insensitive" } },
          select: { id: true, name: true },
        });
        if (bigExpenseCategory) return bigExpenseCategory;
      }
    }
  }

  // Rule 2: exactly one category matches this transaction's type
  const wantTypes = TYPE_MAP[transactionType] ?? [CategoryType.VARIABLE_EXPENSE, CategoryType.FIXED_EXPENSE];
  const eligible = await tx.category.findMany({
    where: { userId, type: { in: wantTypes } },
    select: { id: true, name: true },
  });
  if (eligible.length === 1) return eligible[0];

  return null;
}
