interface MatchableAccount {
  id: string;
  name: string;
}

/**
 * Matches a transfer's merchant/description text against the user's own
 * OTHER account names (e.g. "MASHREQBANK PSC" contains "Mashreq") — lets an
 * outgoing transfer's destination resolve immediately from the message
 * itself, without waiting for a second SMS/email leg to arrive and match on
 * amount+direction (matchInternalTransfer's approach, which fails entirely
 * when only one side of a transfer ever gets imported/parsed).
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
