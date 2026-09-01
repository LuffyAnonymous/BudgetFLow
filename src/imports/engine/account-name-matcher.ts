interface MatchableAccount {
  id: string;
  name: string;
}

/**
 * Matches a transfer's merchant/description text against the user's own
 * OTHER account names (e.g. "MASHREQBANK PSC" contains "Mashreq"). Not
 * currently called by any production code path — ingestion (Phase 1, see
 * import.service.ts) never resolves toAccountId from the message text
 * anymore, and reconcile-transfers.service.ts's Phase 2 matching is
 * amount+time only, per the two-phase transfer redesign. Left in place
 * (with its own test coverage) as a real, working utility in case
 * description-based matching is wired into Phase 2 later — not dead code
 * kept by accident.
 */
export function matchAccountByDescription(
  accounts: MatchableAccount[],
  description: string | null
): MatchableAccount | null {
  if (!description) return null;
  const d = description.toLowerCase();

  for (const account of accounts) {
    const name = account.name.trim().toLowerCase();
    if (name.length > 0 && d.includes(name)) {
      return account;
    }
  }

  return null;
}
