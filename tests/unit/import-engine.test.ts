/**
 * tests/unit/import-engine.test.ts
 *
 * Unit tests for the SMS import engine (pure logic, no database).
 *
 * Covers:
 *   - EmiratesNBDParser: canParse, parse, amount extraction, reference, confidence
 *   - Available balance NOT imported as transaction amount
 *   - Account masking
 *   - Duplicate fingerprint stability
 *   - Rules engine
 *   - Transaction builder shape
 *   - Redaction utility
 */

import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { EmiratesNBDParser } from "@/imports/sms/emirates-nbd.parser";
import { SmsParserRegistry } from "@/imports/sms/parser-registry";
import { buildFingerprint } from "@/imports/engine/duplicate-detector";
import { defaultRulesEngine } from "@/imports/rules/rules-engine";
import { buildImportTransactionData } from "@/imports/engine/transaction-builder";
import {
  redactFinancialText,
  maskAccountNumber,
  maskSender,
  sha256,
} from "@/imports/engine/redaction";
import type { NormalizedSmsTransaction } from "@/imports/sms/sms-parser.interface";
import { ImportConfidence, ImportSource, TransactionType, CashFlowDirection } from "@prisma/client";

// ─── Sample SMS ──────────────────────────────────────────────────────────────

const VALID_SMS =
  "AED 5,750.00 has been credited to your account no. 014557001234501 " +
  "DTB SALARY TR REF EPHCOP1810A4BEZH 2229XXX62XXX-19. " +
  "The available balance is AED 5,752.56.";

const VALID_SENDER = "ENBD";
const RECEIVED_AT = new Date("2026-07-11T08:30:00.000Z");

// ─── Parser tests ─────────────────────────────────────────────────────────────

describe("EmiratesNBDParser", () => {
  const parser = new EmiratesNBDParser();

  describe("canParse()", () => {
    it("returns true for valid ENBD salary SMS", () => {
      expect(parser.canParse(VALID_SENDER, VALID_SMS)).toBe(true);
    });

    it("returns false when sender is not ENBD", () => {
      expect(parser.canParse("ADCB", VALID_SMS)).toBe(false);
    });

    it("returns true when SALARY TR REF marker is absent (parsed with LOW confidence in 7.2)", () => {
      const noRef = VALID_SMS.replace("SALARY TR REF EPHCOP1810A4BEZH", "");
      expect(parser.canParse(VALID_SENDER, noRef)).toBe(true);
    });

    it("returns true when credit pattern is absent (parsed with LOW confidence in 7.2)", () => {
      const noCredit = VALID_SMS.replace("has been credited to your account", "was deposited");
      expect(parser.canParse(VALID_SENDER, noCredit)).toBe(true);
    });

    it("returns true for a generic 'credited' message without salary markers (parsed with LOW confidence in 7.2)", () => {
      const generic =
        "AED 100.00 has been credited to your account no. 01412345. Thank you.";
      expect(parser.canParse(VALID_SENDER, generic)).toBe(true);
    });

    it("returns false for an OTP message from ENBD sender", () => {
      expect(
        parser.canParse("ENBD", "Your OTP is 123456. Valid for 5 minutes.")
      ).toBe(false);
    });
  });

  describe("parse() — amount extraction", () => {
    it("extracts salary amount 5750.00 from the valid SMS", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.amount.toFixed(2)).toBe("5750.00");
    });

    it("handles commas in amount (5,750.00 → 5750.00)", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.amount.equals(new Decimal("5750.00"))).toBe(true);
    });

    it("does NOT import the available balance (5752.56) as the salary amount", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.amount.toFixed(2)).not.toBe("5752.56");
    });


  });

  describe("parse() — reference extraction", () => {
    it("extracts reference EPHCOP1810A4BEZH", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.reference).toBe("EPHCOP1810A4BEZH");
    });

    it("reference is uppercase", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.reference).toBe(result.reference?.toUpperCase());
    });

    it("reference is null when no token follows SALARY TR REF", () => {
      // Construct a message where SALARY TR REF is followed by end-of-string (no token)
      const noRef =
        "AED 5,750.00 has been credited to your account no. 014XXX01 " +
        "DTB SALARY TR REF.";
      const result = parser.parse(VALID_SENDER, noRef, RECEIVED_AT);
      expect(result.reference).toBeNull();
    });
  });

  describe("parse() — normalization shape", () => {
    it("returns source = SMS", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.source).toBe("SMS");
    });

    it("returns institution = Emirates NBD", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.institution).toBe("Emirates NBD");
    });



    it("returns currency = AED", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.currency).toBe("AED");
    });



    it("returns parserKey and parserVersion", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.parserKey).toBe("emirates-nbd-salary-v1");
      expect(result.parserVersion).toBe("1.0.0");
    });

    it("redactedMessage does not contain raw account digits (014557001234501)", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.redactedMessage).not.toContain("014557001234501");
    });

    it("payloadHash is a 64-char hex string", () => {
      const result = parser.parse(VALID_SENDER, VALID_SMS, RECEIVED_AT);
      expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });


});

// ─── Parser Registry ──────────────────────────────────────────────────────────

describe("SmsParserRegistry", () => {
  const registry = new SmsParserRegistry();
  const allowlist = ["ENBD"];

  it("returns matched outcome for valid ENBD salary SMS", () => {
    const result = registry.select(VALID_SENDER, VALID_SMS, allowlist);
    expect(result.outcome).toBe("matched");
  });

  it("returns no_match when sender not in allowlist", () => {
    const result = registry.select("ENBD", VALID_SMS, []);
    expect(result.outcome).toBe("no_match");
  });

  it("returns matched when message format unknown (low confidence in 7.2)", () => {
    const result = registry.select(
      "ENBD",
      "Your ENBD card ending 1234 was charged AED 50.00",
      allowlist
    );
    expect(result.outcome).toBe("matched");
  });

  it("sender matching is case-insensitive", () => {
    const result = registry.select("enbd", VALID_SMS, ["ENBD"]);
    expect(result.outcome).toBe("matched");
  });
});

// ─── Fingerprint ─────────────────────────────────────────────────────────────

describe("buildFingerprint()", () => {
  const makeNormalized = (overrides: Partial<NormalizedSmsTransaction> = {}): NormalizedSmsTransaction => ({
    source: "SMS",
    institution: "Emirates NBD",
    parserKey: "emirates-nbd-salary-v1",
    parserVersion: "1.0.0",
    amount: new Decimal("5750.00"),
    currency: "AED",
    merchant: null,
    reference: "EPHCOP1810A4BEZH",
    transactionDate: RECEIVED_AT,
    redactedMessage: "",
    payloadHash: "",
    availableBalance: null,
    accountEnding: null,
    isDeclined: false,
    metadata: {},
    ...overrides,
  });

  it("produces the same fingerprint for the same transaction", () => {
    const n = makeNormalized();
    expect(buildFingerprint(n, "ENBD")).toBe(buildFingerprint(n, "ENBD"));
  });

  it("produces different fingerprints for different references", () => {
    const a = buildFingerprint(makeNormalized({ reference: "REF001" }), "ENBD");
    const b = buildFingerprint(makeNormalized({ reference: "REF002" }), "ENBD");
    expect(a).not.toBe(b);
  });

  it("produces different fingerprints for different amounts", () => {
    const a = buildFingerprint(makeNormalized({ amount: new Decimal("5000.00") }), "ENBD");
    const b = buildFingerprint(makeNormalized({ amount: new Decimal("6000.00") }), "ENBD");
    expect(a).not.toBe(b);
  });

  it("reference-based fingerprint is independent of date", () => {
    const date1 = new Date("2026-07-01T00:00:00Z");
    const date2 = new Date("2026-07-11T08:30:00Z");
    const a = buildFingerprint(makeNormalized({ transactionDate: date1 }), "ENBD");
    const b = buildFingerprint(makeNormalized({ transactionDate: date2 }), "ENBD");
    // Same reference → same fingerprint regardless of date
    expect(a).toBe(b);
  });

  it("date-based fingerprint differs by day when no reference", () => {
    const n1 = makeNormalized({ reference: null, transactionDate: new Date("2026-07-01T00:00:00Z") });
    const n2 = makeNormalized({ reference: null, transactionDate: new Date("2026-07-02T00:00:00Z") });
    expect(buildFingerprint(n1, "ENBD")).not.toBe(buildFingerprint(n2, "ENBD"));
  });

  it("is a 64-char hex SHA-256", () => {
    const fp = buildFingerprint(makeNormalized(), "ENBD");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Rules Engine ─────────────────────────────────────────────────────────────

describe("RulesEngine", () => {
  it("matches 'Salary' description to categoryKey SALARY", () => {
    const result = defaultRulesEngine.apply({
      source: "SMS",
      institution: "Emirates NBD",
      parserKey: "emirates-nbd-salary-v1",
      parserVersion: "1.0.0",
      amount: new Decimal("5750.00"),
      currency: "AED",
      merchant: "Salary",
      reference: "EPHCOP1810A4BEZH",
      transactionDate: RECEIVED_AT,
      redactedMessage: "",
      payloadHash: "",
      availableBalance: null,
      accountEnding: null,
      isDeclined: false,
      metadata: {},
    });
    expect(result.categoryKey).toBe("SALARY");
    expect(result.matchedRuleId).toBe("builtin-salary");
  });

  it("matches when parserKey contains 'salary'", () => {
    const result = defaultRulesEngine.apply({
      source: "SMS",
      institution: "Emirates NBD",
      parserKey: "emirates-nbd-salary-v1",
      parserVersion: "1.0.0",
      amount: new Decimal("5750.00"),
      currency: "AED",
      merchant: "Credit",
      reference: "REF001",
      transactionDate: RECEIVED_AT,
      redactedMessage: "",
      payloadHash: "",
      availableBalance: null,
      accountEnding: null,
      isDeclined: false,
      metadata: {},
    });
    expect(result.categoryKey).toBe("SALARY");
  });
});

// ─── Transaction Builder ──────────────────────────────────────────────────────

describe("buildImportTransactionData()", () => {
  const normalized: NormalizedSmsTransaction = {
    source: "SMS",
    institution: "Emirates NBD",
    parserKey: "emirates-nbd-salary-v1",
    parserVersion: "1.0.0",
    amount: new Decimal("5750.00"),
    currency: "AED",
    merchant: "Salary",
    reference: "EPHCOP1810A4BEZH",
    transactionDate: RECEIVED_AT,
    redactedMessage: "",
    payloadHash: "",
    availableBalance: null,
    accountEnding: null,
    isDeclined: false,
    metadata: {},
  };

  it("sets type to INCOME for INCOME transaction", () => {
    const data = buildImportTransactionData(normalized, "cat-123", { type: TransactionType.INCOME });
    expect(data.type).toBe(TransactionType.INCOME);
  });

  it("sets cashFlowDirection to INFLOW for INCOME", () => {
    const data = buildImportTransactionData(normalized, "cat-123", { type: TransactionType.INCOME });
    expect(data.cashFlowDirection).toBe(CashFlowDirection.INFLOW);
  });

  it("sets importSource to SMS", () => {
    const data = buildImportTransactionData(normalized, "cat-123");
    expect(data.importSource).toBe(ImportSource.SMS);
  });

  it("sets paymentMethod to SMS Import", () => {
    const data = buildImportTransactionData(normalized, "cat-123");
    expect(data.paymentMethod).toBe("SMS Import");
  });

  it("uses the provided categoryId", () => {
    const data = buildImportTransactionData(normalized, "cat-xyz");
    expect(data.categoryId).toBe("cat-xyz");
  });

  it("amount is positive Decimal with 2 decimal places", () => {
    const data = buildImportTransactionData(normalized, "cat-123");
    expect(data.amount.toFixed(2)).toBe("5750.00");
    expect(data.amount.isPositive()).toBe(true);
  });

  it("notes include institution and reference", () => {
    const data = buildImportTransactionData(normalized, "cat-123");
    expect(data.notes).toContain("Emirates NBD");
    expect(data.notes).toContain("EPHCOP1810A4BEZH");
  });
});

// ─── Redaction Utility ────────────────────────────────────────────────────────

describe("Redaction utility", () => {
  describe("maskAccountNumber()", () => {
    it("masks raw account number to keep first 3 and last 2", () => {
      expect(maskAccountNumber("014557001234501")).toBe("014XXX01");
    });

    it("preserves already-masked accounts", () => {
      expect(maskAccountNumber("014XXX70XXX01")).toBe("014XXX70XXX01");
    });

    it("handles lowercase x as already masked", () => {
      expect(maskAccountNumber("014xxx01")).toBe("014XXX01");
    });
  });

  describe("redactFinancialText()", () => {
    it("redacts account number after 'account no.'", () => {
      const result = redactFinancialText(
        "credited to your account no. 014557001234501 DTB SALARY"
      );
      expect(result).not.toContain("014557001234501");
      expect(result).toContain("account no. 014XXX01");
    });

    it("does not redact valid transaction reference EPHCOP1810A4BEZH", () => {
      const result = redactFinancialText(VALID_SMS);
      expect(result).toContain("EPHCOP1810A4BEZH");
    });

    it("preserves the balance amount (for display purposes)", () => {
      const result = redactFinancialText(VALID_SMS);
      expect(result).toContain("5,752.56");
    });
  });

  describe("maskSender()", () => {
    it("returns sender label for alphanumeric sender", () => {
      expect(maskSender("ENBD")).toBe("ENBD");
    });

    it("masks phone number sender", () => {
      expect(maskSender("+971501234567")).toBe("SMS_SENDER");
    });
  });

  describe("sha256()", () => {
    it("returns 64-char hex", () => {
      expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic", () => {
      expect(sha256("hello")).toBe(sha256("hello"));
    });

    it("differs for different inputs", () => {
      expect(sha256("hello")).not.toBe(sha256("world"));
    });
  });
});
