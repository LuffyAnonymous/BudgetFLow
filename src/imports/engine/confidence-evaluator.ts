import { TransactionDirection } from "./direction-classifier";
import { KnownCategory } from "./merchant-categorizer";

export function evaluateConfidence(
  amountFound: boolean,
  direction: TransactionDirection,
  merchantCategory: KnownCategory,
  hasReference: boolean,
  hasAvailableBalance: boolean
): number {
  let score = 100;

  if (!amountFound) {
    return 0; // Absolute zero if no amount
  }

  if (direction === TransactionDirection.INFORMATIONAL || direction === TransactionDirection.PENDING || direction === TransactionDirection.DECLINED) {
    return 100; // Confident it's an informational/ignored message
  }

  if (merchantCategory === KnownCategory.UNCATEGORIZED && direction !== TransactionDirection.INFLOW) {
    score -= 35; // Drops to 65 (Review queue)
  }

  if (!hasAvailableBalance) {
    score -= 10;
  }

  if (!hasReference) {
    score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}
