export enum SupportedBank {
  MASHREQ = "Mashreq",
  EMIRATES_NBD = "EmiratesNBD",
}

/**
 * Normalizes a raw SMS sender string into a known SupportedBank.
 * Matching is case-insensitive and whitespace-tolerant.
 */
export function normalizeSender(rawSender: string): SupportedBank | null {
  if (!rawSender) return null;

  const normalized = rawSender.replace(/\s+/g, "").toLowerCase();

  if (normalized.includes("mashreq")) {
    return SupportedBank.MASHREQ;
  }

  if (normalized.includes("enbd") || normalized.includes("emiratesnbd")) {
    return SupportedBank.EMIRATES_NBD;
  }

  return null;
}
