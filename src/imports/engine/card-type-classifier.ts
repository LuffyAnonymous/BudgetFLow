/**
 * A "Credit Card ending 4521" purchase increases what's owed, unlike a
 * "Debit Card" purchase which spends real cash straight out of a checking
 * account. Bank SMS wording reliably distinguishes the two, so a simple
 * keyword check is enough to route credit card activity to its own
 * liability-tracked account instead of colliding with the bank's checking
 * account.
 */
const CREDIT_CARD_RE = /credit\s*card/i;

export function isCreditCardTransaction(message: string): boolean {
  return CREDIT_CARD_RE.test(message);
}
