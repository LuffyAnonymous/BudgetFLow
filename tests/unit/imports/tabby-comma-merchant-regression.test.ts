import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../../src/imports/engine/import.service";

/**
 * Regression test for a real production incident: a comma in the merchant
 * field ("at Tabby, 800 82229, DUBAI.") broke merchant extraction entirely,
 * which dropped the confidence score below the auto-post threshold purely
 * because a recognizable BNPL merchant looked unrecognized. Fixed in
 * emirates-nbd.parser.ts / generic-bank-credit-debit.parser.ts by treating a
 * comma as a merchant-field terminator.
 */
describe("Real-world message: Tabby charge with comma-separated merchant detail", () => {
  let userId: string;

  beforeEach(async () => {
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({ where: { email: "tabby_comma_regression@budgetflow.ae" } });

    const user = await db.user.create({
      data: {
        email: "tabby_comma_regression@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Regression Tester",
      },
    });
    userId = user.id;

    await db.importSetting.create({
      data: { userId, enabled: true, senderAllowlist: ["ENBD"] },
    });

    await db.category.createMany({
      data: [
        { userId, name: "Buy Now Pay Later", type: "VARIABLE_EXPENSE" },
        { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" },
      ],
    });
  });

  it("auto-posts instead of landing in manual review", async () => {
    const message = "Purchase of AED 1.00 with Debit Card ending 8014 at Tabby, 800 82229, DUBAI. Avl Balance is AED 0.48.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId }, include: { category: true } });
      expect(tx).not.toBeNull();
      expect(tx!.amount.toFixed(2)).toBe("1.00");
      expect(tx!.description).toBe("TABBY");
      expect(tx!.category.name).toBe("Buy Now Pay Later");
    }
  });
});
