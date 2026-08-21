import { describe, it, expect } from "vitest";
import { matchDebtByDescription } from "../../../src/imports/engine/debt-matcher";

describe("matchDebtByDescription", () => {
  const debts = [
    { id: "debt-1", name: "Ahmed Loan", payeeAliases: ["Ahmed Ali", "AHMED ALI M"] },
    { id: "debt-2", name: "Sara Loan", payeeAliases: ["Sara Khan"] },
    { id: "debt-3", name: "No aliases yet", payeeAliases: [] },
  ];

  it("returns null for a null description", () => {
    expect(matchDebtByDescription(debts, null)).toBeNull();
  });

  it("returns null when no debt's aliases match", () => {
    expect(matchDebtByDescription(debts, "Transfer to Random Person")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(matchDebtByDescription(debts, "transfer to ahmed ali")?.id).toBe("debt-1");
  });

  it("matches a substring of the description", () => {
    expect(matchDebtByDescription(debts, "Transferred AED 250.00 to Sara Khan Ref 12345")?.id).toBe("debt-2");
  });

  it("matches an alternate spelling alias", () => {
    expect(matchDebtByDescription(debts, "AHMED ALI M - SALARY ADVANCE")?.id).toBe("debt-1");
  });

  it("never matches a debt with no aliases registered", () => {
    expect(matchDebtByDescription(debts, "No aliases yet")).toBeNull();
  });

  it("returns the first matching debt when multiple could match", () => {
    const overlapping = [
      { id: "debt-a", name: "A", payeeAliases: ["John"] },
      { id: "debt-b", name: "B", payeeAliases: ["John"] },
    ];
    expect(matchDebtByDescription(overlapping, "Transfer to John")?.id).toBe("debt-a");
  });
});
