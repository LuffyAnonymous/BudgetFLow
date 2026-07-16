import { SupportedBank } from "./sender-normalizer";

export enum TransactionDirection {
  INFLOW = "INFLOW",
  OUTFLOW = "OUTFLOW",
  PENDING = "PENDING",
  INFORMATIONAL = "INFORMATIONAL",
  DECLINED = "DECLINED",
}

export function classifyDirection(
  message: string,
  bank: SupportedBank
): TransactionDirection {
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
  if (
    lowerMsg.includes("credited") ||
    lowerMsg.includes("salary") ||
    lowerMsg.includes("refund") ||
    lowerMsg.includes("deposited") ||
    lowerMsg.includes("received")
  ) {
    return TransactionDirection.INFLOW;
  }

  // Outflow
  if (
    lowerMsg.includes("purchase") ||
    lowerMsg.includes("debited") ||
    lowerMsg.includes("transfer") ||
    lowerMsg.includes("withdrawn") ||
    lowerMsg.includes("payment of") ||
    lowerMsg.includes("used for") ||
    lowerMsg.includes("transaction of") ||
    lowerMsg.includes("charged") ||
    lowerMsg.includes("spent") ||
    lowerMsg.includes("withdrew")
  ) {
    return TransactionDirection.OUTFLOW;
  }

  // Default to informational if we can't tell
  return TransactionDirection.INFORMATIONAL;
}
