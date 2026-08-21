interface MatchableDebt {
  id: string;
  name: string;
  payeeAliases: string[];
}

/**
 * Matches an outgoing transaction's description against each debt's
 * registered payee aliases (case-insensitive substring), so a personal
 * transfer like "transferred AED 250 to Ahmed Ali" can be auto-applied to
 * the right debt without a manual Record Payment click.
 */
export function matchDebtByDescription(debts: MatchableDebt[], description: string | null): MatchableDebt | null {
  if (!description) return null;
  const d = description.toLowerCase();

  for (const debt of debts) {
    for (const alias of debt.payeeAliases) {
      const a = alias.trim().toLowerCase();
      if (a.length > 0 && d.includes(a)) {
        return debt;
      }
    }
  }

  return null;
}
