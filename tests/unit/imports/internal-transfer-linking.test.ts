import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../../src/imports/engine/import.service";
import { AccountService } from "../../../src/server/services/account.service";

const accountService = new AccountService();

/**
 * A transfer between two of the user's own accounts arrives as two separate
 * SMS legs. matchInternalTransfer() links the second leg onto the first
 * leg's existing Transaction row instead of creating a duplicate — but the
 * row only ever had accountId (whichever leg arrived first) set, never
 * toAccountId (the other side). That's harmless for the immediately-cached
 * Account.currentBalance (each leg bumps its own account directly on
 * arrival), but accountService.updateAccountBalance() — the ledger-based
 * recompute used by reconciliation — sums TRANSFER inflows via
 * `toAccountId = accountId`, so the destination account's incoming half
 * silently disappears the moment anything recomputes from the ledger.
 */
describe("Internal transfer linking (accountId/toAccountId)", () => {
  let userId: string;

  beforeEach(async () => {
    await db.notification.deleteMany({});
    await db.debtPayment.deleteMany({});
    await db.debt.deleteMany({});
    await db.importedTransaction.deleteMany({});
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
    await db.category.deleteMany({});
    await db.importSetting.deleteMany({});
    await db.user.deleteMany({ where: { email: "transfer_linking@budgetflow.ae" } });

    const user = await db.user.create({
      data: {
        email: "transfer_linking@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Transfer Linking Tester",
      },
    });
    userId = user.id;

    await db.importSetting.create({
      data: { userId, enabled: true, senderAllowlist: ["ENBD", "MASHREQ"] },
    });

    await db.category.create({
      data: { userId, name: "Transfers", type: "VARIABLE_EXPENSE" },
    });
  });

  it("links both legs onto a single Transaction row with accountId and toAccountId both set", async () => {
    const outMessage = "Transfer of AED 500.00 to Mashreq Account 1234. Available balance is AED 2,000.00. Ref TXN001";
    const legOut = await importService.processSms(userId, {
      sender: "ENBD",
      message: outMessage,
      receivedAt: new Date(),
    });
    expect(legOut.outcome).toBe("auto_posted");
    if (legOut.outcome !== "auto_posted") return;

    // Deliberately no "Available balance" line on this leg: updateBalance()
    // treats a present balance line as authoritative and writes it straight
    // onto Account.currentBalance/latestImportedBalance, which would let the
    // later recompute below short-circuit on that snapshot instead of
    // actually summing the ledger — masking the bug this test exists to
    // catch. Omitting it forces the account to start from a clean baseline
    // (no latestImportedBalance/lastSMSImportedAt), so updateAccountBalance()
    // has to derive Mashreq's balance purely from aggregating Transaction
    // rows, which is exactly the path that depends on toAccountId.
    const inMessage = "AED 500.00 received from Emirates NBD. Ref TXN002";
    const legIn = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: inMessage,
      receivedAt: new Date(),
    });
    expect(legIn.outcome).toBe("auto_posted");
    if (legIn.outcome !== "auto_posted") return;

    // Both legs should have matched onto the same single ledger transaction.
    expect(legIn.transactionId).toBe(legOut.transactionId);

    const tx = await db.transaction.findUniqueOrThrow({
      where: { id: legOut.transactionId },
      include: { account: true, toAccount: true },
    });
    expect(tx.account?.type).toBe("EMIRATES_NBD");
    expect(tx.toAccount?.type).toBe("MASHREQ");
    expect(tx.toAccountId).not.toBeNull();

    const enbdAccount = tx.account!;
    const mashreqAccount = tx.toAccount!;

    // Immediately-cached balance is correct regardless of the bug (this leg
    // bumps its own account directly on arrival via the amount+direction
    // increment path, since there's no availableBalance snapshot to prefer)
    // — this alone would pass even before the fix, so it's not the
    // interesting assertion.
    const beforeRecompute = await db.account.findMany({ where: { userId } });
    const mashreqBefore = beforeRecompute.find((a) => a.id === mashreqAccount.id)!;
    expect(Number(mashreqBefore.currentBalance)).toBe(500);

    // Regression assertion: recompute from the ledger (what reconciliation
    // actually uses) must still show Mashreq's 500 inflow. Before the fix,
    // toAccountId was never set, so this recompute would silently zero out
    // Mashreq's transfer-in and leave its balance at 0 instead of 500.
    await accountService.updateAccountBalance(userId, enbdAccount.id);
    await accountService.updateAccountBalance(userId, mashreqAccount.id);

    const afterRecompute = await db.account.findMany({ where: { userId } });
    const mashreqAfter = afterRecompute.find((a) => a.id === mashreqAccount.id)!;
    expect(Number(mashreqAfter.currentBalance)).toBe(500);
  });

  it("never overwrites an already-populated toAccountId on a matched row", async () => {
    const outMessage = "Transfer of AED 300.00 to Mashreq Account 1234. Available balance is AED 700.00. Ref TXN010";
    const legOut = await importService.processSms(userId, {
      sender: "ENBD",
      message: outMessage,
      receivedAt: new Date(),
    });
    expect(legOut.outcome).toBe("auto_posted");
    if (legOut.outcome !== "auto_posted") return;

    const inMessage = "AED 300.00 received from Emirates NBD. Available balance is AED 800.00. Ref TXN011";
    const legIn = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: inMessage,
      receivedAt: new Date(),
    });
    expect(legIn.outcome).toBe("auto_posted");

    const txBefore = await db.transaction.findUniqueOrThrow({ where: { id: legOut.transactionId } });
    const originalToAccountId = txBefore.toAccountId;
    expect(originalToAccountId).not.toBeNull();

    // matchInternalTransfer() matches on amount + opposite direction alone —
    // it doesn't exclude rows that are already fully linked (see
    // transfer-matcher.ts: `if (tx.toAccountId) return tx.id;`). So a THIRD,
    // same-amount incoming message will still resolve matchedTransferId back
    // to the already-linked row above. The fix must not let this silently
    // relink/corrupt toAccountId a second time.
    const thirdMessage = "AED 300.00 received from Emirates NBD. Available balance is AED 1,100.00. Ref TXN013";
    const legThird = await importService.processSms(userId, {
      sender: "MASHREQ",
      message: thirdMessage,
      receivedAt: new Date(),
    });
    expect(legThird.outcome).toBe("auto_posted");

    const txAfter = await db.transaction.findUniqueOrThrow({ where: { id: legOut.transactionId } });
    expect(txAfter.toAccountId).toBe(originalToAccountId);
  });
});
