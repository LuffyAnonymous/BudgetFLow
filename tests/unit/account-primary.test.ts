import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { AccountService } from "../../src/server/services/account.service";

const accountService = new AccountService();

describe("AccountService.setPrimaryAccount / getPrimaryAccount", () => {
  let userId: string;
  let otherUserId: string;
  let accountA: string;
  let accountB: string;

  beforeEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.user.deleteMany({ where: { email: { in: ["account_primary@budgetflow.ae", "account_primary_other@budgetflow.ae"] } } });

    const user = await db.user.create({
      data: { email: "account_primary@budgetflow.ae", passwordHash: "dummy-hash", name: "Primary Tester" },
    });
    userId = user.id;

    const otherUser = await db.user.create({
      data: { email: "account_primary_other@budgetflow.ae", passwordHash: "dummy-hash", name: "Other User" },
    });
    otherUserId = otherUser.id;

    const a = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD" } });
    const b = await db.account.create({ data: { userId, name: "Mashreq", type: "MASHREQ" } });
    accountA = a.id;
    accountB = b.id;
  });

  it("returns null when no primary has been set yet", async () => {
    expect(await accountService.getPrimaryAccount(userId)).toBeNull();
  });

  it("sets the target account as primary", async () => {
    const updated = await accountService.setPrimaryAccount(userId, accountA);
    expect(updated.isPrimary).toBe(true);

    const primary = await accountService.getPrimaryAccount(userId);
    expect(primary?.id).toBe(accountA);
  });

  it("enforces at most one primary account per user — switching unsets the previous one", async () => {
    await accountService.setPrimaryAccount(userId, accountA);
    await accountService.setPrimaryAccount(userId, accountB);

    const accounts = await db.account.findMany({ where: { userId } });
    const primaries = accounts.filter((a) => a.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(accountB);
  });

  it("rejects an accountId that does not belong to the user", async () => {
    await expect(accountService.setPrimaryAccount(otherUserId, accountA)).rejects.toThrow("ACCOUNT_NOT_FOUND");
  });
});
