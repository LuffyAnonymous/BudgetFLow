import { describe, it, expect, beforeEach } from "vitest";
import { smsParserRegistry, getCanonicalSender } from "../../src/imports/sms/parser-registry";

describe("Sender Alias and Case-Insensitive Matching", () => {
  const allowlist = ["ENBD", "MASHREQ"];

  it("getCanonicalSender helper resolves correctly", () => {
    expect(getCanonicalSender("Mashreq")).toBe("MASHREQ");
    expect(getCanonicalSender("mashreq")).toBe("MASHREQ");
    expect(getCanonicalSender("MASHREQ")).toBe("MASHREQ");
    expect(getCanonicalSender(" Mashreq ")).toBe("MASHREQ");

    expect(getCanonicalSender("EmiratesNBD")).toBe("ENBD");
    expect(getCanonicalSender("emiratesnbd")).toBe("ENBD");
    expect(getCanonicalSender("ENBD")).toBe("ENBD");
    expect(getCanonicalSender(" EmiratesNBD ")).toBe("ENBD");
  });

  it("Mashreq matches MASHREQ", () => {
    const result = smsParserRegistry.select("Mashreq", "Test message", allowlist);
    expect(result.outcome).not.toBe("no_match");
    if (result.outcome === "no_match") {
      expect(result.reason).not.toBe("Sender not in configured allowlist");
    }
  });

  it("mashreq matches MASHREQ", () => {
    const result = smsParserRegistry.select("mashreq", "Test message", allowlist);
    expect(result.outcome).not.toBe("no_match");
    if (result.outcome === "no_match") {
      expect(result.reason).not.toBe("Sender not in configured allowlist");
    }
  });

  it("EmiratesNBD matches ENBD", () => {
    const result = smsParserRegistry.select("EmiratesNBD", "Test message", allowlist);
    expect(result.outcome).not.toBe("no_match");
    if (result.outcome === "no_match") {
      expect(result.reason).not.toBe("Sender not in configured allowlist");
    }
  });

  it("emiratesnbd matches ENBD", () => {
    const result = smsParserRegistry.select("emiratesnbd", "Test message", allowlist);
    expect(result.outcome).not.toBe("no_match");
    if (result.outcome === "no_match") {
      expect(result.reason).not.toBe("Sender not in configured allowlist");
    }
  });

  it("whitespace is ignored in both inputs and allowlist", () => {
    const customAllowlist = ["  ENBD  ", " Mashreq "];
    
    const res1 = smsParserRegistry.select("  EmiratesNBD  ", "Test message", customAllowlist);
    expect(res1.outcome).not.toBe("no_match");
    
    const res2 = smsParserRegistry.select(" Mashreq ", "Test message", customAllowlist);
    expect(res2.outcome).not.toBe("no_match");
  });

  it("unknown senders are still rejected", () => {
    const result = smsParserRegistry.select("ADCB", "Test message", allowlist);
    expect(result.outcome).toBe("no_match");
    if (result.outcome === "no_match") {
      expect(result.reason).toBe("Sender not in configured allowlist");
    }
  });
});

import { db } from "@/lib/db";
import { importService } from "../../src/imports/engine/import.service";

describe("Sender Matching Integration with DB", () => {
  let userId: string;

  beforeEach(async () => {
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    const user = await db.user.create({
      data: {
        email: "alias_db_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Alias DB Tester",
      },
    });
    userId = user.id;

    // Create ImportSetting with "ENBD" and "MASHREQ" in the allowlist
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD", "MASHREQ"],
      },
    });
  });

  it("successfully processes 'Mashreq' payload and does not reject with allowlist error", async () => {
    const result = await importService.processSms(userId, {
      sender: "Mashreq",
      message: "Test transaction AED 50.00 at Carrefour",
      receivedAt: new Date("2026-07-15T04:52:00.000Z"),
    });

    // It should not fail with "Sender not in configured allowlist"
    expect(result.outcome).not.toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).not.toBe("Sender not in configured allowlist");
    }
  });
});
