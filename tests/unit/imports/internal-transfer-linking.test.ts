import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "../../../src/imports/engine/import.service";
import { AccountService } from "../../../src/server/services/account.service";
import { reconcileTransfers } from "../../../src/imports/reconciliation/reconcile-transfers.service";

const accountService = new AccountService();

/**
 * Two-phase transfer design: Phase 1 (ingestion) posts each SMS/email leg
 * as its own independent EXPENSE/INCOME transaction immediately, with no
 * attempt at cross-account matching — see import.service.ts's
 * autoPostTransaction doc comment. Phase 2 (reconcileTransfers(), run on a
 * schedule) is what actually pairs and merges matching legs into one
 * canonical TRANSFER row. This file tests that split explicitly: ingestion
 * must never merge, and reconciliation must correctly merge (and correctly
 * leave unmatched legs alone).
 */
describe("Two-phase internal transfer linking", () => {
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

  describe("Phase 1 — ingestion never merges across accounts", () => {
    it("posts both legs of a transfer as independent EXPENSE/INCOME rows, both UNMATCHED", async () => {
      const outMessage = "Transfer of AED 500.00 to Mashreq Account 1234. Available balance is AED 2,000.00. Ref TXN001";
      const legOut = await importService.processSms(userId, {
        sender: "ENBD",
        message: outMessage,
        receivedAt: new Date(),
      });
      expect(legOut.outcome).toBe("auto_posted");
      if (legOut.outcome !== "auto_posted") return;

      const inMessage = "AED 500.00 received from Emirates NBD. Ref TXN002";
      const legIn = await importService.processSms(userId, {
        sender: "MASHREQ",
        message: inMessage,
        receivedAt: new Date(),
      });
      expect(legIn.outcome).toBe("auto_posted");
      if (legIn.outcome !== "auto_posted") return;

      // Never merged at ingestion — two separate Transaction rows.
      expect(legIn.transactionId).not.toBe(legOut.transactionId);

      const outTx = await db.transaction.findUniqueOrThrow({ where: { id: legOut.transactionId } });
      const inTx = await db.transaction.findUniqueOrThrow({ where: { id: legIn.transactionId } });

      expect(outTx.type).toBe("EXPENSE");
      expect(outTx.toAccountId).toBeNull();
      expect(outTx.transferMatchStatus).toBe("UNMATCHED");

      expect(inTx.type).toBe("INCOME");
      expect(inTx.transferMatchStatus).toBe("UNMATCHED");

      // Each leg's own account balance is still correct immediately —
      // Phase 1 still updates the balance for its single leg, exactly as
      // it would for any normal expense/income.
      const mashreqAccount = await db.account.findUniqueOrThrow({ where: { id: inTx.accountId! } });
      expect(Number(mashreqAccount.currentBalance)).toBe(500);
    });
  });

  describe("Phase 2 — reconcileTransfers() merges matching legs", () => {
    it("merges an exact-amount, different-account UNMATCHED pair into one canonical TRANSFER row", async () => {
      const legOut = await importService.processSms(userId, {
        sender: "ENBD",
        message: "Transfer of AED 500.00 to Mashreq Account 1234. Available balance is AED 2,000.00. Ref TXN001",
        receivedAt: new Date(),
      });
      const legIn = await importService.processSms(userId, {
        sender: "MASHREQ",
        // Deliberately no "Available balance" line: updateBalance() treats a
        // present balance line as authoritative, which would let the later
        // recompute short-circuit on that snapshot instead of actually
        // summing the ledger — masking the bug this test exists to catch.
        message: "AED 500.00 received from Emirates NBD. Ref TXN002",
        receivedAt: new Date(),
      });
      if (legOut.outcome !== "auto_posted" || legIn.outcome !== "auto_posted") throw new Error("setup failed");

      const result = await reconcileTransfers(userId);
      expect(result.matched).toBe(1);
      expect(result.scanned).toBe(2);

      const outTx = await db.transaction.findUniqueOrThrow({
        where: { id: legOut.transactionId },
        include: { account: true, toAccount: true },
      });
      expect(outTx.type).toBe("TRANSFER");
      expect(outTx.transferMatchStatus).toBe("MATCHED");
      expect(outTx.account?.type).toBe("EMIRATES_NBD");
      expect(outTx.toAccount?.type).toBe("MASHREQ");

      const inTx = await db.transaction.findUniqueOrThrow({ where: { id: legIn.transactionId } });
      expect(inTx.transferMatchStatus).toBe("MERGED");
      expect(inTx.mergedIntoTransactionId).toBe(outTx.id);
      // Never deleted — history and ImportedTransaction links stay intact.
      expect(inTx.type).toBe("INCOME");

      // Ledger recompute (what reconciliation itself just used) must show
      // Mashreq's 500 inflow exactly once, not zero (MERGED row silently
      // dropped) and not twice (MERGED row double-counted alongside the
      // new TRANSFER row's toAccountId inflow).
      await accountService.updateAccountBalance(userId, outTx.accountId!);
      await accountService.updateAccountBalance(userId, outTx.toAccountId!);
      const mashreqAfter = await db.account.findUniqueOrThrow({ where: { id: outTx.toAccountId! } });
      expect(Number(mashreqAfter.currentBalance)).toBe(500);
    });

    it("leaves an unmatched leg exactly as posted — no flag, no status change, expected steady state", async () => {
      const legOut = await importService.processSms(userId, {
        sender: "ENBD",
        message: "Transfer of AED 500.00 to Some External Bank. Available balance is AED 2,000.00. Ref TXN099",
        receivedAt: new Date(),
      });
      if (legOut.outcome !== "auto_posted") throw new Error("setup failed");

      const result = await reconcileTransfers(userId);
      expect(result.matched).toBe(0);
      expect(result.scanned).toBe(1);

      const outTx = await db.transaction.findUniqueOrThrow({ where: { id: legOut.transactionId } });
      expect(outTx.type).toBe("EXPENSE");
      expect(outTx.transferMatchStatus).toBe("UNMATCHED");
      expect(outTx.toAccountId).toBeNull();
    });

    it("does not match two legs on the same account, or legs whose amounts differ even slightly (exact match only)", async () => {
      const enbd = await db.account.create({ data: { userId, name: "Emirates NBD", type: "EMIRATES_NBD" } });
      const mashreq = await db.account.create({ data: { userId, name: "Mashreq", type: "MASHREQ" } });
      const category = await db.category.findFirstOrThrow({ where: { userId } });

      // Same account on both sides — must never match.
      await db.transaction.create({
        data: {
          userId, accountId: enbd.id, categoryId: category.id, date: new Date(), amount: 500,
          description: "a", paymentMethod: "SMS Import", type: "EXPENSE", cashFlowDirection: "OUTFLOW", origin: "SMS_IMPORT",
        },
      });
      await db.transaction.create({
        data: {
          userId, accountId: enbd.id, categoryId: category.id, date: new Date(), amount: 500,
          description: "b", paymentMethod: "SMS Import", type: "INCOME", cashFlowDirection: "INFLOW", origin: "SMS_IMPORT",
        },
      });

      // Different accounts but amounts differ by a cent — no tolerance.
      await db.transaction.create({
        data: {
          userId, accountId: enbd.id, categoryId: category.id, date: new Date(), amount: 300.00,
          description: "c", paymentMethod: "SMS Import", type: "EXPENSE", cashFlowDirection: "OUTFLOW", origin: "SMS_IMPORT",
        },
      });
      await db.transaction.create({
        data: {
          userId, accountId: mashreq.id, categoryId: category.id, date: new Date(), amount: 300.01,
          description: "d", paymentMethod: "SMS Import", type: "INCOME", cashFlowDirection: "INFLOW", origin: "SMS_IMPORT",
        },
      });

      const result = await reconcileTransfers(userId);
      expect(result.matched).toBe(0);
      expect(result.scanned).toBe(4);
    });

    it("is safe to call twice in a row — the second call matches nothing new", async () => {
      const legOut = await importService.processSms(userId, {
        sender: "ENBD",
        message: "Transfer of AED 250.00 to Mashreq Account 1234. Available balance is AED 1,000.00. Ref TXN500",
        receivedAt: new Date(),
      });
      const legIn = await importService.processSms(userId, {
        sender: "MASHREQ",
        message: "AED 250.00 received from Emirates NBD. Ref TXN501",
        receivedAt: new Date(),
      });
      if (legOut.outcome !== "auto_posted" || legIn.outcome !== "auto_posted") throw new Error("setup failed");

      const first = await reconcileTransfers(userId);
      expect(first.matched).toBe(1);

      const second = await reconcileTransfers(userId);
      expect(second.matched).toBe(0);
      expect(second.scanned).toBe(0); // both legs are no longer UNMATCHED
    });
  });
});
