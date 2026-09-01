import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { findTransferMatchPairs, type CandidateTransaction } from "../../../src/imports/reconciliation/transfer-matching";

function outflow(overrides: Partial<CandidateTransaction> = {}): CandidateTransaction {
  return {
    id: "out-1",
    accountId: "acc-a",
    amount: new Decimal("100.00"),
    occurredAt: new Date("2026-08-01T10:00:00Z"),
    type: "EXPENSE",
    cashFlowDirection: "OUTFLOW",
    ...overrides,
  };
}

function inflow(overrides: Partial<CandidateTransaction> = {}): CandidateTransaction {
  return {
    id: "in-1",
    accountId: "acc-b",
    amount: new Decimal("100.00"),
    occurredAt: new Date("2026-08-01T10:01:00Z"),
    type: "INCOME",
    cashFlowDirection: "INFLOW",
    ...overrides,
  };
}

describe("findTransferMatchPairs", () => {
  it("matches an exact-amount, different-account outflow/inflow pair", () => {
    const pairs = findTransferMatchPairs([outflow(), inflow()]);
    expect(pairs).toEqual([{ outflowId: "out-1", inflowId: "in-1" }]);
  });

  it("does not match same-account legs", () => {
    const pairs = findTransferMatchPairs([outflow({ accountId: "acc-a" }), inflow({ accountId: "acc-a" })]);
    expect(pairs).toHaveLength(0);
  });

  it("requires an exact amount match — no tolerance, no fuzzy matching", () => {
    const pairs = findTransferMatchPairs([
      outflow({ amount: new Decimal("100.00") }),
      inflow({ amount: new Decimal("100.01") }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("picks the closest-in-time candidate when multiple inflows have the same amount", () => {
    const far = inflow({ id: "in-far", occurredAt: new Date("2026-08-01T12:00:00Z") });
    const close = inflow({ id: "in-close", occurredAt: new Date("2026-08-01T10:00:30Z") });
    const pairs = findTransferMatchPairs([outflow(), far, close]);
    expect(pairs).toEqual([{ outflowId: "out-1", inflowId: "in-close" }]);
  });

  it("never claims the same inflow for two different outflows", () => {
    const sharedInflow = inflow();
    const out1 = outflow({ id: "out-1", occurredAt: new Date("2026-08-01T10:00:00Z") });
    const out2 = outflow({ id: "out-2", occurredAt: new Date("2026-08-01T10:00:10Z") });
    const pairs = findTransferMatchPairs([out1, out2, sharedInflow]);
    expect(pairs).toHaveLength(1);
    // The earlier-processed outflow (sorted oldest-first) claims it.
    expect(pairs[0].outflowId).toBe("out-1");
  });

  it("leaves an outflow with no matching inflow unpaired", () => {
    const pairs = findTransferMatchPairs([outflow()]);
    expect(pairs).toHaveLength(0);
  });

  it("ignores transactions that are neither a plain EXPENSE/OUTFLOW nor a plain INCOME/INFLOW", () => {
    const transferRow: CandidateTransaction = {
      id: "already-transfer",
      accountId: "acc-c",
      amount: new Decimal("100.00"),
      occurredAt: new Date("2026-08-01T10:00:00Z"),
      type: "TRANSFER",
      cashFlowDirection: "OUTFLOW",
    };
    const pairs = findTransferMatchPairs([outflow(), transferRow]);
    expect(pairs).toHaveLength(0);
  });

  it("ignores candidates with no accountId", () => {
    const pairs = findTransferMatchPairs([outflow({ accountId: null }), inflow()]);
    expect(pairs).toHaveLength(0);
  });
});
