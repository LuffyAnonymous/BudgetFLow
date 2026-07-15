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

  // Outflow
  if (
    lowerMsg.includes("purchase") ||
    lowerMsg.includes("debited") ||
    lowerMsg.includes("transfer") ||
    lowerMsg.includes("withdrawn") ||
    lowerMsg.includes("payment of") ||
    lowerMsg.includes("used for") ||
    lowerMsg.includes("transaction of")
  ) {
    return TransactionDirection.OUTFLOW;
  }

  // Inflow
  if (
    lowerMsg.includes("credited") ||
    lowerMsg.includes("salary") ||
    lowerMsg.includes("refund") ||
    lowerMsg.includes("deposited")
  ) {
    return TransactionDirection.INFLOW;
  }

  // Default to informational if we can't tell
  return TransactionDirection.INFORMATIONAL;
}
