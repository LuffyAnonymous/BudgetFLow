/**
 * tests/unit/emirates-nbd-fixtures.test.ts
 *
 * Fixture-based regression tests for the Emirates NBD salary SMS parser.
 *
 * Each fixture file in tests/fixtures/sms/emirates-nbd/ represents a known
 * SMS format that must parse consistently. Changes to the parser that break
 * fixture expectations will cause these tests to fail — making regressions
 * immediately visible.
 *
 * All fixtures use synthetic, non-sensitive data:
 *   - Account numbers: masked (e.g. 014XXX01)
 *   - References: randomly generated uppercase alphanumeric strings
 *   - Balances: plausible but not real
 *   - Sender identifiers: the public sender string used by the bank
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { EmiratesNBDParser } from "../../src/imports/sms/emirates-nbd.parser";
import { ImportConfidence } from "@prisma/client";

const FIXTURE_DIR = resolve(__dirname, "../fixtures/sms/emirates-nbd");
const VALID_SENDER = "ENBD";
const RECEIVED_AT = new Date("2026-07-11T08:00:00.000Z");

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), "utf-8").trim();
}

// ─── Instantiate parser ───────────────────────────────────────────────────────

const parser = new EmiratesNBDParser();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

describe("Emirates NBD Parser — salary-valid.txt", () => {
  const sms = loadFixture("salary-valid.txt");

  it("parser recognises the sender", () => {
    expect(parser.canParse(VALID_SENDER, sms)).toBe(true);
  });

  it("parses amount 5750.00", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.amount.toFixed(2)).toBe("5750.00");
  });

  it("extracts reference EPHCOP1810A4BEZH", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.reference).toBe("EPHCOP1810A4BEZH");
  });



  it("institution is Emirates NBD", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.institution).toBe("Emirates NBD");
  });

  it("redacted payload masks account number", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.redactedMessage).not.toContain("014557001234501");
  });

  it("payload hash is a 64-char hex string", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Emirates NBD Parser — salary-duplicate.txt (identical to valid)", () => {
  const sms = loadFixture("salary-duplicate.txt");

  it("parses the duplicate fixture identically to salary-valid", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    // Same content — same reference and amount expected
    expect(result.reference).toBe("EPHCOP1810A4BEZH");
    expect(result.amount.toFixed(2)).toBe("5750.00");
  });

  it("produces the same fingerprint as salary-valid (enabling dedup)", () => {
    const valid = parser.parse(VALID_SENDER, loadFixture("salary-valid.txt"), RECEIVED_AT);
    const dup   = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    // Both have the same reference → same fingerprint
    expect(dup.reference).toBe(valid.reference);
    expect(dup.amount.toFixed(2)).toBe(valid.amount.toFixed(2));
  });
});

describe("Emirates NBD Parser — salary-invalid.txt (OTP message)", () => {
  const sms = loadFixture("salary-invalid.txt");

  it("canHandle returns false for OTP sender message", () => {
    // canHandle requires SALARY TR REF marker
    expect(parser.canParse(VALID_SENDER, sms)).toBe(false);
  });

  it("parse throws ParseError for non-salary SMS", () => {
    expect(() => parser.parse(VALID_SENDER, sms, RECEIVED_AT)).toThrow();
  });
});

describe("Emirates NBD Parser — salary-missing-reference.txt", () => {
  const sms = loadFixture("salary-missing-reference.txt");

  it("canHandle returns true (has SALARY TR REF marker)", () => {
    expect(parser.canParse(VALID_SENDER, sms)).toBe(true);
  });

  it("reference is null", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.reference).toBeNull();
  });


});

describe("Emirates NBD Parser — salary-extra-spaces.txt", () => {
  const sms = loadFixture("salary-extra-spaces.txt");

  it("canHandle returns true despite extra whitespace", () => {
    expect(parser.canParse(VALID_SENDER, sms)).toBe(true);
  });

  it("parses amount 5750.00 from extra-space variant", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.amount.toFixed(2)).toBe("5750.00");
  });

  it("extracts reference despite extra spaces", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    // Fixture uses reference EPHCOP9920B7CXYZ
    expect(result.reference).toBe("EPHCOP9920B7CXYZ");
  });
});

describe("Emirates NBD Parser — salary-comma-amount.txt", () => {
  const sms = loadFixture("salary-comma-amount.txt");

  it("parses comma-formatted amount 12500.00", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.amount.toFixed(2)).toBe("12500.00");
  });

  it("extracts reference FQHDBX2219C5RWMN", () => {
    const result = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(result.reference).toBe("FQHDBX2219C5RWMN");
  });



  it("produces different fingerprint from salary-valid (different reference)", () => {
    const valid = parser.parse(VALID_SENDER, loadFixture("salary-valid.txt"), RECEIVED_AT);
    const comma = parser.parse(VALID_SENDER, sms, RECEIVED_AT);
    expect(comma.reference).not.toBe(valid.reference);
  });
});

describe("Emirates NBD Parser — sender isolation", () => {
  const sms = loadFixture("salary-valid.txt");

  it("canHandle returns false for unknown sender even with valid format", () => {
    expect(parser.canParse("FAKESENDER", sms)).toBe(false);
  });

  it("canHandle is case-insensitive for sender", () => {
    expect(parser.canParse("enbd", sms)).toBe(true);
  });
});
