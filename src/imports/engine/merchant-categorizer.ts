export enum KnownCategory {
  GROCERIES = "Groceries",
  FOOD_DELIVERY = "Food Delivery",
  TRANSPORT = "Transport",
  FUEL = "Fuel",
  BNPL = "Buy Now Pay Later",
  DINING = "Dining",
  TRANSFERS = "Transfers",
  SHOPPING = "Shopping",
  TELECOM_UTILITIES = "Utilities",
  HEALTH = "Health",
  ENTERTAINMENT = "Entertainment",
  UNCATEGORIZED = "Uncategorized"
}

const CATEGORY_KEYWORDS: Record<Exclude<KnownCategory, KnownCategory.UNCATEGORIZED>, string[]> = {
  [KnownCategory.GROCERIES]: [
    "carrefour", "lulu", "new era", "madhoor", "spinneys", "waitrose",
    "union coop", "zoom", "west zone", "choithrams", "viva supermarket",
    "grandiose", "kibsons"
  ],
  [KnownCategory.FOOD_DELIVERY]: [
    "talabat", "noon food", "keeta", "deliveroo", "zomato", "instashop", "cari"
  ],
  [KnownCategory.TRANSPORT]: [
    "careem", "uber", "rta", "salik", "nol", "yango", "arrow car"
  ],
  [KnownCategory.FUEL]: [
    "adnoc", "enoc", "eppco", "emarat"
  ],
  [KnownCategory.BNPL]: [
    "tabby", "tamara", "postpay", "spotii"
  ],
  [KnownCategory.DINING]: [
    "restaurant", "cafe", "starbucks", "costa", "tim hortons", "mcdonald",
    "kfc", "subway", "shake shack", "five guys", "coffee"
  ],
  [KnownCategory.TRANSFERS]: [
    "emirates nbd", "enbd", "adcb", "mashreq", "first abu dhabi bank", "fab",
    "rakbank", "commercial bank of dubai", "cbd", "dubai islamic bank", "dib",
    "adib", "wio", "liv."
  ],
  [KnownCategory.SHOPPING]: [
    "amazon", "noon.com", "shein", "namshi", "ikea", "sharaf dg", "jumbo electronics"
  ],
  [KnownCategory.TELECOM_UTILITIES]: [
    "etisalat", "du telecom", "dewa", "sewa", "addc", "fewa"
  ],
  [KnownCategory.HEALTH]: [
    "life pharmacy", "aster pharmacy", "boots pharmacy", "medcare", "aster clinic",
    "mediclinic"
  ],
  [KnownCategory.ENTERTAINMENT]: [
    "netflix", "spotify", "anghami", "vox cinemas", "reel cinemas",
    "apple.com/bill", "google play"
  ]
};

/**
 * Deterministically categorizes merchants against a fixed keyword list.
 * Order matters where brand names could span multiple buckets (e.g. "du telecom"
 * checked before any future transport keyword starting with "du").
 */
export function categorizeMerchant(merchant: string | null): KnownCategory {
  if (!merchant) return KnownCategory.UNCATEGORIZED;

  const m = merchant.toLowerCase();

  for (const category of Object.values(KnownCategory)) {
    if (category === KnownCategory.UNCATEGORIZED) continue;
    const keywords = CATEGORY_KEYWORDS[category as Exclude<KnownCategory, KnownCategory.UNCATEGORIZED>];
    if (keywords.some((keyword) => m.includes(keyword))) {
      return category;
    }
  }

  return KnownCategory.UNCATEGORIZED;
}
