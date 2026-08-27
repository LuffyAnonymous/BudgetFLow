export enum TransactionDirection {
  INFLOW = "INFLOW",
  OUTFLOW = "OUTFLOW",
  PENDING = "PENDING",
  INFORMATIONAL = "INFORMATIONAL",
  DECLINED = "DECLINED",
}

export const INFLOW_KEYWORDS = [
  "credited",
  "salary",
  "refund",
  "deposited",
  "received",
] as const;

export const OUTFLOW_KEYWORDS = [
  "purchase",
  "debited",
  "transfer",
  "withdrawn",
  "payment of",
  "used for",
  "transaction of",
  "charged",
  "spent",
  "withdrew",
] as const;

export function classifyDirection(message: string): TransactionDirection {
  const lowerMsg = message.toLowerCase();

  // Declined / Failed
  if (lowerMsg.includes("declined") || lowerMsg.includes("failed") || lowerMsg.includes("unsuccessful")) {
    return TransactionDirection.DECLINED;
  }

  // Pending
  if (lowerMsg.includes("pending")) {
    return TransactionDirection.PENDING;
  }

  // OTP / Info
  if (lowerMsg.includes("otp") || lowerMsg.includes("code is")) {
    return TransactionDirection.INFORMATIONAL;
  }

  // Inflow (Check this first to catch "received a transfer" before just "transfer")
  if (INFLOW_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    return TransactionDirection.INFLOW;
  }

  // Outflow
  if (OUTFLOW_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    return TransactionDirection.OUTFLOW;
  }

  // Default to informational if we can't tell
  return TransactionDirection.INFORMATIONAL;
}

/**
 * True when a message matches both inflow and outflow keyword sets — e.g.
 * "Transfer received of AED 500" matches "received" (inflow) and "transfer"
 * (outflow). classifyDirection() resolves these by keyword-check order alone,
 * with no signal that it was a coin-flip. Callers use this to flag the
 * transaction for review rather than trust the guess silently.
 */
export function isDirectionAmbiguous(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  const matchesInflow = INFLOW_KEYWORDS.some((kw) => lowerMsg.includes(kw));
  const matchesOutflow = OUTFLOW_KEYWORDS.some((kw) => lowerMsg.includes(kw));
  return matchesInflow && matchesOutflow;
}
