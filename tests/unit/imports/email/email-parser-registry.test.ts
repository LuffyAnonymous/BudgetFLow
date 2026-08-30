import { describe, it, expect } from "vitest";
import { emailParserRegistry } from "../../../../src/imports/email/parser-registry";

const now = new Date("2026-08-19T20:00:00Z");

const enbdTransferBody = [
  "Here is a consolidated status of your Local Bank Transfer.",
  "Transaction Date: 15/Mar/2026 02:30 PM",
  "Debit Amount: AED 500.00",
  "Beneficiary Name: Jane Doe",
  "Channel Reference No: TESTREF123456",
  "Status: Success",
].join("\n");

describe("emailParserRegistry.select", () => {
  it("matches the ENBD parser for a recognized ENBD Local Bank Transfer email", () => {
    const result = emailParserRegistry.select("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", enbdTransferBody);
    expect(result.outcome).toBe("matched");
    if (result.outcome === "matched") {
      expect(result.parser.parserKey).toBe("emirates-nbd-local-transfer-email-v1");
    }
  });

  it("returns no_match for an unrecognized sender", () => {
    const result = emailParserRegistry.select("noreply@somebank.com", "Transaction Alert", "AED 50.00 debited.");
    expect(result.outcome).toBe("no_match");
  });

  it("returns no_match for a Mashreq email (stub never claims anything)", () => {
    const result = emailParserRegistry.select("alerts@mashreqbank.com", "Transaction Alert", "AED 50.00 debited.");
    expect(result.outcome).toBe("no_match");
  });
});

describe("emailParserRegistry.parse", () => {
  it("returns a normalized transaction for a recognized, well-formed email", () => {
    const result = emailParserRegistry.parse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", enbdTransferBody, now, "gmail-msg-x");
    expect(result).not.toBeNull();
    expect(result!.result.amount.toFixed(2)).toBe("500.00");
  });

  it("returns null when the sender isn't recognized at all", () => {
    const result = emailParserRegistry.parse("noreply@somebank.com", "Transaction Alert", "AED 50.00 debited.", now, "gmail-msg-y");
    expect(result).toBeNull();
  });

  it("returns null when a parser matches but can't extract required fields (e.g. Status not Success)", () => {
    const pendingBody = enbdTransferBody.replace("Status: Success", "Status: Pending");
    const result = emailParserRegistry.parse("OnlineBanking@emiratesnbd.com", "Local Bank Transfer", pendingBody, now, "gmail-msg-z");
    expect(result).toBeNull();
  });
});
