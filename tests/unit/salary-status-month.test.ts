import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { importService } from "@/imports/engine/import.service";
import { accountService } from "@/server/services/account.service";
import { AccountType, ImportStatus } from "@prisma/client";

let currentTestUserId = "";

vi.mock("@/auth", () => ({
  auth: async () => ({
    user: { id: currentTestUserId, email: "test@budgetflow.ae" },
  }),
}));

describe("Salary Status Scoped to Active Budget Month", () => {
  let userId: string;

  beforeEach(async () => {
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({});

    const user = await db.user.create({
      data: {
        email: "salary_status_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Salary Status Tester",
      },
    });
    userId = user.id;
    currentTestUserId = userId;

    await accountService.ensureDefaultAccounts(userId);

    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        senderAllowlist: ["ENBD"],
      },
    });

    await db.category.create({
      data: {
        userId,
        name: "Salary",
        type: "INCOME",
      },
    });
  });

  it("proves July salary status does not return the August-attributed salary, and August salary status returns the AED 5,750 salary received on 28 July", async () => {
    // 1. Process salary SMS received on 28 July 2026 for AED 5,750
    const sms = "AED 5,750.00 has been credited to your account no. 014557001234501 DTB SALARY. The available balance is AED 5,752.56.";
    const res = await importService.processSms(userId, {
      sender: "ENBD",
      message: sms,
      receivedAt: new Date("2026-07-28T10:33:00.000Z"),
    });

    expect(res.outcome).toBe("auto_posted");

    // Verify transaction and importedTransaction have budgetMonth = "2026-08" while receivedAt/date is 28 July 2026
    const tx = await db.transaction.findFirst({ where: { userId, amount: 5750 } });
    expect(tx?.budgetMonth).toBe("2026-08");
    expect(tx?.date.toISOString()).toContain("2026-07-28");

    const impTx = await db.importedTransaction.findFirst({ where: { userId } });
    expect(impTx?.budgetMonth).toBe("2026-08");

    // 2. Query DB directly for July 2026 budget month (month=2026-07)
    const julyDbMatch = await db.importedTransaction.findFirst({
      where: {
        userId,
        status: ImportStatus.PROCESSED,
        OR: [
          { budgetMonth: "2026-07" },
          {
            budgetMonth: null,
            receivedAt: { gte: new Date("2026-07-01T00:00:00Z"), lt: new Date("2026-08-01T00:00:00Z") },
          },
        ],
      },
    });
    expect(julyDbMatch).toBeNull();

    // 3. Query DB directly for August 2026 budget month (month=2026-08)
    const augDbMatch = await db.importedTransaction.findFirst({
      where: {
        userId,
        status: ImportStatus.PROCESSED,
        OR: [
          { budgetMonth: "2026-08" },
          {
            budgetMonth: null,
            receivedAt: { gte: new Date("2026-08-01T00:00:00Z"), lt: new Date("2026-09-01T00:00:00Z") },
          },
        ],
      },
    });
    expect(augDbMatch).not.toBeNull();
    expect(augDbMatch?.parsedAmount?.toString()).toBe("5750");
    expect(augDbMatch?.budgetMonth).toBe("2026-08");

    // 4. Query API endpoint /api/imports/salary-status for July 2026
    const { GET: getSalaryStatus } = await import("@/app/api/imports/salary-status/route");
    const julyReq = new Request("http://localhost:3000/api/imports/salary-status?month=2026-07");
    const julyRes = await (await getSalaryStatus(julyReq)).json();

    expect(julyRes.data.month).toBe("2026-07");
    expect(julyRes.data.latestImport).toBeNull();
    expect(julyRes.data.status).not.toBe("received");

    // 5. Query API endpoint /api/imports/salary-status for August 2026
    const augReq = new Request("http://localhost:3000/api/imports/salary-status?month=2026-08");
    const augRes = await (await getSalaryStatus(augReq)).json();

    expect(augRes.data.month).toBe("2026-08");
    expect(augRes.data.latestImport).not.toBeNull();
    expect(augRes.data.latestImport.amount).toBe("5750");
    expect(augRes.data.latestImport.budgetMonth).toBe("2026-08");
    expect(augRes.data.status).toBe("received");

    // 6. Verify ENBD balance remains unchanged at 5,752.56
    const accounts = await accountService.getAccounts(userId);
    const enbd = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
    expect(enbd.currentBalance.toFixed(2)).toBe("5752.56");
  });
});
