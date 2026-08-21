import { describe, it, expect } from "vitest";
import { evaluateConfidence } from "../../../src/imports/engine/confidence-evaluator";
import { KnownCategory } from "../../../src/imports/engine/merchant-categorizer";
import { TransactionDirection } from "../../../src/imports/engine/direction-classifier";

describe("evaluateConfidence", () => {
  it("returns 0 when no amount was found", () => {
    expect(evaluateConfidence(false, TransactionDirection.OUTFLOW, KnownCategory.GROCERIES, true, true)).toBe(0);
  });

  it("returns 100 for informational/pending/declined messages regardless of other factors", () => {
    expect(evaluateConfidence(true, TransactionDirection.INFORMATIONAL, KnownCategory.UNCATEGORIZED, false, false)).toBe(100);
    expect(evaluateConfidence(true, TransactionDirection.PENDING, KnownCategory.UNCATEGORIZED, false, false)).toBe(100);
    expect(evaluateConfidence(true, TransactionDirection.DECLINED, KnownCategory.UNCATEGORIZED, false, false)).toBe(100);
  });

  it("penalizes an uncategorized outflow merchant by 35, landing below the 70 auto-post bar", () => {
    const score = evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.UNCATEGORIZED, true, true);
    expect(score).toBe(65);
  });

  it("does not penalize an uncategorized INFLOW (e.g. an unrecognized salary sender)", () => {
    const score = evaluateConfidence(true, TransactionDirection.INFLOW, KnownCategory.UNCATEGORIZED, true, true);
    expect(score).toBe(100);
  });

  it("exempts an uncategorized OUTFLOW from the penalty when it matches a registered debt payee", () => {
    const withoutPayee = evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.UNCATEGORIZED, true, true, false);
    const withPayee = evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.UNCATEGORIZED, true, true, true);
    expect(withoutPayee).toBe(65);
    expect(withPayee).toBe(100);
  });

  it("still applies the missing-balance and missing-reference penalties even for a known debt payee", () => {
    const score = evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.UNCATEGORIZED, false, false, true);
    expect(score).toBe(85); // 100 - 10 (no balance) - 5 (no reference)
  });

  it("subtracts 10 for missing available balance and 5 for missing reference independently", () => {
    expect(evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.GROCERIES, true, false)).toBe(90);
    expect(evaluateConfidence(true, TransactionDirection.OUTFLOW, KnownCategory.GROCERIES, false, true)).toBe(95);
  });
});
