import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../src/imports/engine/import.service";

describe("Import Engine Enabled/Disabled Account Gating", () => {
  let userId: string;

  beforeEach(async () => {
    // Clean database tables
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    // Create test user
    const user = await db.user.create({
      data: {
        email: "gating_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Gating Tester",
      },
    });
    userId = user.id;
  });

  it("disabled account returns disabled outcome", async () => {
    // Create ImportSetting with enabled = false
    await db.importSetting.create({
      data: {
        userId,
        enabled: false,
      },
    });

    const result = await importService.processSms(userId, {
      sender: "ENBD",
      message: "AED 100 spent at store.",
      receivedAt: new Date(),
    });

    expect(result.outcome).toBe("disabled");
  });

  it("enabled account returns a non-disabled outcome", async () => {
    // Create ImportSetting with enabled = true
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD"],
      },
    });

    const result = await importService.processSms(userId, {
      sender: "ENBD",
      message: "AED 5,750.00 has been credited to your account no. 014557001234501 DTB SALARY. The available balance is AED 5,752.56.",
      receivedAt: new Date(),
    });

    // Should not be "disabled" since import engine is enabled for this account
    expect(result.outcome).not.toBe("disabled");
  });
});
