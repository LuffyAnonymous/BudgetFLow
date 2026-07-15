/**
 * src/imports/rules/rules-engine.ts
 *
 * Import Rules Engine — architecture-first implementation.
 *
 * Rules are applied to a NormalizedSmsTransaction to suggest:
 *   - categoryKey: a stable budget-group key (e.g. "SALARY")
 *
 * Rules are evaluated in priority order; first match wins.
 *
 * Current built-in rules (salary only):
 *   - If description === "Salary" OR parserKey matches "salary" → categoryKey = "SALARY"
 *
 * Future rules (when ready):
 *   - IF merchant contains "Carrefour" → categoryKey = "GROCERIES"
 *   - IF merchant contains "Talabat"   → categoryKey = "DINING"
 *   User-editable rules will be added as a separate model when UI is built.
 */

import type { NormalizedSmsTransaction } from "../sms/sms-parser.interface";

export const MERCHANT_CATEGORIES: Record<string, string> = {
  CARREFOUR: "Groceries",
  LULU: "Groceries",
  SPINNEYS: "Groceries",
  TALABAT: "Food Delivery",
  DELIVEROO: "Food Delivery",
  CAREEM: "Transport",
  UBER: "Transport",
  RTA: "Transport",
  NOON: "Shopping",
  AMAZON: "Shopping",
  APPLE: "Subscriptions",
  NETFLIX: "Entertainment",
};

// ─── Rule types ───────────────────────────────────────────────────────────────

export interface ImportRule {
  id: string;
  description: string;
  priority: number;
  /** Returns true if this rule applies to the transaction */
  condition: (normalized: NormalizedSmsTransaction) => boolean;
  /** Suggested budget group key to look up in the user's categories */
  action: { categoryKey: string };
}

export interface RuleEngineResult {
  categoryKey: string | null;
  matchedRuleId: string | null;
}

// ─── Built-in rules ───────────────────────────────────────────────────────────

const BUILT_IN_RULES: ImportRule[] = [
  {
    id: "builtin-salary",
    description: "Salary credit detected via SALARY TR REF marker",
    priority: 100,
    condition: (n) =>
      (n.merchant ?? "").toLowerCase() === "salary" ||
      n.parserKey.toLowerCase().includes("salary"),
    action: { categoryKey: "SALARY" },
  },
  {
    id: "builtin-transfer",
    description: "Internal transfer from ENBD to Mashreq",
    priority: 90,
    condition: (n) =>
      n.institution === "Emirates NBD" &&
      /transfer/i.test(n.merchant ?? ""),
    action: { categoryKey: "TRANSFERS" },
  },
  {
    id: "builtin-atm",
    description: "ATM Cash Withdrawal",
    priority: 85,
    condition: (n) =>
      n.institution === "Emirates NBD" &&
      /ATM/i.test(n.merchant ?? ""),
    action: { categoryKey: "RENT_CASH" },
  },
  {
    id: "builtin-tabby",
    description: "Tabby Debt Payment",
    priority: 80,
    condition: (n) =>
      n.merchant !== null &&
      /tabby/i.test(n.merchant),
    action: { categoryKey: "DEBT" },
  },
  {
    id: "builtin-table-tennis",
    description: "Table Tennis Equipment Payment",
    priority: 75,
    condition: (n) =>
      n.merchant !== null &&
      /table\s*tennis|butterfly|stiga|tt\s*equipment/i.test(n.merchant),
    action: { categoryKey: "DEBT" },
  },
  {
    id: "builtin-nol",
    description: "RTA NOL Card top-up",
    priority: 70,
    condition: (n) =>
      n.merchant !== null &&
      /nol|rta|roads\s*and\s*transport/i.test(n.merchant),
    action: { categoryKey: "TRANSPORTATION" },
  },
  {
    id: "builtin-taptap",
    description: "TapTap Send Remittance",
    priority: 65,
    condition: (n) =>
      n.merchant !== null &&
      /taptap\s*send/i.test(n.merchant),
    action: { categoryKey: "REMITTANCE" },
  },
];

// ─── Engine ───────────────────────────────────────────────────────────────────

export class RulesEngine {
  private readonly rules: ImportRule[];

  constructor(customRules: ImportRule[] = []) {
    // Built-in rules always included; custom rules sorted by priority
    this.rules = [...BUILT_IN_RULES, ...customRules].sort(
      (a, b) => b.priority - a.priority
    );
  }

  /**
   * Apply rules to a normalized transaction.
   * Returns the first matching rule's categoryKey, or null if no rule matched.
   */
  apply(normalized: NormalizedSmsTransaction): RuleEngineResult {
    for (const rule of this.rules) {
      if (rule.condition(normalized)) {
        return {
          categoryKey: rule.action.categoryKey,
          matchedRuleId: rule.id,
        };
      }
    }
    return { categoryKey: null, matchedRuleId: null };
  }
}

/** Default singleton using only built-in rules */
export const defaultRulesEngine = new RulesEngine();
