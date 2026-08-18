export enum KnownCategory {
  GROCERIES = "Groceries",
  FOOD_DELIVERY = "Food Delivery",
  TRANSPORT = "Transport",
  BNPL = "Buy Now Pay Later",
  DINING = "Dining",
  TRANSFERS = "Transfers",
  UNCATEGORIZED = "Uncategorized"
}

/**
 * Deterministically categorizes merchants.
 */
export function categorizeMerchant(merchant: string | null): KnownCategory {
  if (!merchant) return KnownCategory.UNCATEGORIZED;

  const m = merchant.toLowerCase();

  if (m.includes("carrefour") || m.includes("lulu") || m.includes("new era") || m.includes("madhoor")) {
    return KnownCategory.GROCERIES;
  }

  if (m.includes("talabat") || m.includes("noon food") || m.includes("keeta")) {
    return KnownCategory.FOOD_DELIVERY;
  }

  if (m.includes("careem") || m.includes("uber") || m.includes("rta")) {
    return KnownCategory.TRANSPORT;
  }

  if (m.includes("tabby") || m.includes("tamara")) {
    return KnownCategory.BNPL;
  }

  if (m.includes("restaurant") || m.includes("cafe")) {
    return KnownCategory.DINING;
  }

  if (m.includes("emirates nbd") || m.includes("enbd")) {
    return KnownCategory.TRANSFERS;
  }

  return KnownCategory.UNCATEGORIZED;
}
