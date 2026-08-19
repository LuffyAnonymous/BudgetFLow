import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../../src/imports/engine/import.service";

/**
 * merchant-categorizer.ts maps Tabby/Tamara to the generic label "Buy Now
 * Pay Later", but a user's own category for this is rarely named that
 * exactly — e.g. "Tabby Payment". A plain exact-name lookup misses that and
 * silently dumps the transaction into "Uncategorized" even though it
 * auto-posts fine. resolveCategoryByAlias (category-resolver.ts) should
 * catch this via a known-alias match.
 */
describe("BNPL category alias resolution", () => {
  let userId: string;

  beforeEach(async () => {
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({ where: { email: "category_alias@budgetflow.ae" } });

    const user = await db.user.create({
      data: {
        email: "category_alias@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Alias Tester",
      },
    });
    userId = user.id;

    await db.importSetting.create({
      data: { userId, enabled: true, senderAllowlist: ["ENBD"] },
    });

    // Deliberately no "Buy Now Pay Later" category — only the user's own
    // custom-named one, plus the mandatory Uncategorized fallback.
    await db.category.createMany({
      data: [
        { userId, name: "Tabby Payment", type: "DEBT" },
        { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" },
      ],
    });
  });

  it("posts a Tabby charge into the user's own 'Tabby Payment' category instead of Uncategorized", async () => {
    const message = "Purchase of AED 1.00 with Debit Card ending 8014 at Tabby, 800 82229, DUBAI. Avl Balance is AED 0.48.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message,
      receivedAt: new Date(),
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId }, include: { category: true } });
      expect(tx?.category.name).toBe("Tabby Payment");
    }
  });
});
