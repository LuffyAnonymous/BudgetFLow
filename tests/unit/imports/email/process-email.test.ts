import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "@/imports/engine/import.service";
import { accountService } from "@/server/services/account.service";
import { AccountType, ImportStatus } from "@prisma/client";

const enbdTransferBody = (overrides: Partial<Record<string, string>> = {}) => {
  const fields: Record<string, string> = {
    "Transaction Date": "15/Mar/2026 02:30 PM",
    "From Account": "014***99***01",
    "Debit Amount": "AED 750.00",
    "Beneficiary Name": "Test Beneficiary",
    "Beneficiary Bank Name": "MASHREQBANK PSC",
    "Channel Reference No": "PROCESSEMAILTEST1",
    Status: "Success",
    ...overrides,
  };
  return [
    "Here is a consolidated status of your Local Bank Transfer.",
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
};

describe("ImportService.processEmail", () => {
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
    await db.user.deleteMany({ where: { email: "process_email_test@budgetflow.ae" } });

    const user = await db.user.create({
      data: { email: "process_email_test@budgetflow.ae", passwordHash: "dummy-hash", name: "Email Import Tester" },
    });
    userId = user.id;

    await db.importSetting.create({ data: { userId, enabled: true, senderAllowlist: [] } });
    await db.category.create({ data: { userId, name: "Uncategorized", type: "VARIABLE_EXPENSE" } });
    await db.category.create({ data: { userId, name: "Transfers", type: "VARIABLE_EXPENSE" } });
  });

  it("auto-posts a recognized, well-formed Emirates NBD transfer email", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: enbdTransferBody(),
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-1",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx).toBeDefined();
      expect(tx!.amount.toFixed(2)).toBe("750.00");
      expect(tx!.origin).toBe("EMAIL_IMPORT");
      expect(tx!.paymentMethod).toBe("Email Import");

      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.source).toBe("EMAIL");
      expect(importedTx!.institutionCode).toBe("ENBD");
      expect(importedTx!.externalMessageId).toBe("gmail-msg-process-1");
      expect(importedTx!.status).toBe(ImportStatus.PROCESSED);
    }
  });

  it("creates the Emirates NBD account with the correct AccountType", async () => {
    await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: enbdTransferBody({ "Channel Reference No": "ACCTTYPETEST1" }),
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-2",
    });

    const account = await db.account.findFirst({ where: { userId, type: AccountType.EMIRATES_NBD } });
    expect(account).toBeDefined();
  });

  it("auto-links toAccountId to the user's own matching account from the message alone, with no second leg", async () => {
    const mashreq = await db.account.create({
      data: { userId, name: "Mashreq", type: AccountType.MASHREQ, currentBalance: 0 },
    });

    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: enbdTransferBody({
        "Beneficiary Bank Name":
          "MASHREQBANK PSC SWIFT / Routing Code: BOMLAEAD Correspondent Bank Name: N/A Transaction Fees: No Fees Channel Reference No: AUTOLINKTEST1 SWIFT Reference No: AUTOLINKSWIFT1 Status: Success",
        "Channel Reference No": "AUTOLINKTEST1",
      }),
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-autolink",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome !== "auto_posted") return;

    const tx = await db.transaction.findUniqueOrThrow({ where: { id: res.transactionId } });
    expect(tx.toAccountId).toBe(mashreq.id);

    // The destination's cached balance reflects the inflow immediately —
    // it has no leg of its own going through updateBalance(), so this only
    // happens if the auto-link path explicitly recomputes it.
    const updatedMashreq = await db.account.findUniqueOrThrow({ where: { id: mashreq.id } });
    expect(Number(updatedMashreq.currentBalance)).toBe(750);
  });

  it("does not auto-link when the user has no account matching the named destination bank", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: enbdTransferBody({ "Channel Reference No": "NOACCOUNTMATCH1" }),
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-noautolink",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome !== "auto_posted") return;

    const tx = await db.transaction.findUniqueOrThrow({ where: { id: res.transactionId } });
    expect(tx.toAccountId).toBeNull();
  });

  it("never auto-links to the source account itself", async () => {
    // A degenerate case: the user's ENBD account name happens to appear in
    // its own transfer's description. Must never self-link.
    await db.account.create({ data: { userId, name: "Emirates NBD", type: AccountType.EMIRATES_NBD, currentBalance: 0 } });

    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: enbdTransferBody({
        "Beneficiary Bank Name": "Emirates NBD Internal",
        "Channel Reference No": "SELFLINKTEST1",
      }),
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-selflink",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome !== "auto_posted") return;

    const tx = await db.transaction.findUniqueOrThrow({ where: { id: res.transactionId } });
    expect(tx.toAccountId).toBeNull();
  });

  it("returns disabled when import is not enabled for the user", async () => {
    await db.importSetting.update({ where: { userId }, data: { enabled: false } });
    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: enbdTransferBody(),
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-3",
    });
    expect(res.outcome).toBe("disabled");
  });

  it("fails with UNRECOGNIZED_SENDER_DOMAIN for a sender domain that isn't registered", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "alerts@somerandombank.com",
      subject: "Transaction Alert",
      body: "AED 100.00 debited.",
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-4",
    });
    expect(res.outcome).toBe("failed");
    if (res.outcome === "failed") {
      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.failureCode).toBe("UNRECOGNIZED_SENDER_DOMAIN");
      expect(importedTx!.status).toBe(ImportStatus.FAILED);
    }
  });

  it("fails with RECOGNIZED_SENDER_NO_PARSER for a Mashreq email that doesn't match the registered debit-alert format", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "alerts@mashreqbank.com",
      subject: "Transaction Alert",
      body: "AED 100.00 debited.",
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-5",
    });
    expect(res.outcome).toBe("failed");
    if (res.outcome === "failed") {
      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.failureCode).toBe("RECOGNIZED_SENDER_NO_PARSER");
    }
  });

  it("auto-posts a recognized, well-formed Mashreq debit-alert email", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "MashreqAlerts@mashreq.com",
      subject: "Transaction Notification",
      body: "Your AC No:XXXXXXXX9523 is debited with AED 200.00 for Aani Instant Payments (Local IPP Transfer). Login to Online Banking for details",
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-mashreq-1",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx!.amount.toFixed(2)).toBe("200.00");
      expect(tx!.origin).toBe("EMAIL_IMPORT");

      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.source).toBe("EMAIL");
      expect(importedTx!.institutionCode).toBe("MASHREQ");
      expect(importedTx!.status).toBe(ImportStatus.PROCESSED);
    }
  });

  it("auto-posts a recognized, well-formed Mashreq card-purchase alert email", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "MashreqAlerts@mashreq.com",
      subject: "Transaction Notification",
      body: "Your NEO VISA Debit Card Card ending with 3411 was used for a purchase of AED 60.00 at e& Digital App Abu Dhabi AE on 31-AUG-2026 05:49 PM. Available limit is AED 44.00",
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-mashreq-card-1",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx!.amount.toFixed(2)).toBe("60.00");
      expect(tx!.origin).toBe("EMAIL_IMPORT");

      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.institutionCode).toBe("MASHREQ");
      expect(importedTx!.status).toBe(ImportStatus.PROCESSED);
    }
  });

  it("fails with EXTRACTION_FAILED when the parser matches but Status isn't Success — never posts a guessed transaction", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: enbdTransferBody({ Status: "Pending", "Channel Reference No": "PENDINGTEST1" }),
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-6",
    });
    expect(res.outcome).toBe("failed");
    if (res.outcome === "failed") {
      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.failureCode).toBe("EXTRACTION_FAILED");
      expect(importedTx!.transactionId).toBeNull();
    }
  });

  it("does not create a duplicate transaction when the same Gmail message ID is processed twice", async () => {
    const payload = {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: enbdTransferBody({ "Channel Reference No": "IDEMPOTENTTEST1" }),
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-idempotent",
    };

    const first = await importService.processEmail(userId, payload);
    expect(first.outcome).toBe("auto_posted");

    const second = await importService.processEmail(userId, payload);
    expect(second.outcome).toBe("idempotent");

    const txCount = await db.transaction.count({ where: { userId } });
    expect(txCount).toBe(1);
  });

  it("dedupes via fingerprint when the same transaction arrives with a different externalMessageId (e.g. re-polled with a fresh message ID)", async () => {
    const bodyText = enbdTransferBody({ "Channel Reference No": "FINGERPRINTTEST1" });

    const first = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: bodyText,
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-fp-a",
    });
    expect(first.outcome).toBe("auto_posted");

    const second = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Local Bank Transfer",
      body: bodyText,
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-fp-b",
    });
    expect(second.outcome).toBe("duplicate");

    const txCount = await db.transaction.count({ where: { userId } });
    expect(txCount).toBe(1);
  });

  it("auto-posts a recognized, well-formed Emirates NBD ATM withdrawal email", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "ATM withdrawal",
      body: "Your ATM withdrawal transaction was successfully completed on 28th Aug 2026 at 16:57 PM . Amount: AED 3,500.00 Available balance: AED 1,500.48 Card number: 443913XXXXXX8014 Account number: 014XXX70XXX01 Machine ID: E4012432 Machine location: JLB Branch Reference number: 624016112506",
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-enbd-atm-1",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx!.amount.toFixed(2)).toBe("3500.00");
      expect(tx!.origin).toBe("EMAIL_IMPORT");

      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.institutionCode).toBe("ENBD");
      expect(importedTx!.status).toBe(ImportStatus.PROCESSED);
    }
  });

  it("auto-posts a recognized, well-formed Emirates NBD salary-credit email", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Be alert, stay safe.",
      body: "Salary of AED 5,750.00 has been credited into your account 014XXX70XXX01. The available balance is AED 5,750.48.",
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-enbd-salary-1",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx!.amount.toFixed(2)).toBe("5750.00");
      expect(tx!.origin).toBe("EMAIL_IMPORT");

      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.institutionCode).toBe("ENBD");
      expect(importedTx!.status).toBe(ImportStatus.PROCESSED);
    }
  });

  it("auto-posts a recognized, well-formed Emirates NBD account-deduction email", async () => {
    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Be alert, stay safe.",
      body: "AED 150.00 has been deducted from your account 014XXX70XXX01 for issuance of Telegraphic Transfer. The available balance is AED 1,350.48.",
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-process-enbd-deduction-1",
    });

    expect(res.outcome).toBe("auto_posted");
    if (res.outcome === "auto_posted") {
      const tx = await db.transaction.findUnique({ where: { id: res.transactionId } });
      expect(tx!.amount.toFixed(2)).toBe("150.00");
      expect(tx!.origin).toBe("EMAIL_IMPORT");

      const importedTx = await db.importedTransaction.findUnique({ where: { id: res.importedTransactionId } });
      expect(importedTx!.institutionCode).toBe("ENBD");
      expect(importedTx!.status).toBe(ImportStatus.PROCESSED);
    }
  });

  describe("merging the two Emirates NBD emails a single wire transfer generates", () => {
    it("merges the generic deduction alert and the specific transfer confirmation into one TRANSFER, not two debits (deduction arrives first)", async () => {
      const mashreq = await db.account.create({
        data: { userId, name: "Mashreq", type: AccountType.MASHREQ },
      });

      const base = new Date("2026-03-15T10:00:00Z");

      const deductionRes = await importService.processEmail(userId, {
        fromAddress: "OnlineBanking@emiratesnbd.com",
        subject: "Be alert, stay safe.",
        body: "AED 150.00 has been deducted from your account 014XXX70XXX01 for issuance of Telegraphic Transfer. The available balance is AED 1,350.48.",
        receivedAt: base,
        externalMessageId: "gmail-msg-merge-deduction-1",
      });
      expect(deductionRes.outcome).toBe("auto_posted");

      const transferRes = await importService.processEmail(userId, {
        fromAddress: "OnlineBanking@emiratesnbd.com",
        subject: "Local Bank Transfer",
        body: enbdTransferBody({
          "Debit Amount": "AED 150.00",
          "Channel Reference No": "MERGETEST1",
        }),
        receivedAt: new Date(base.getTime() + 8000),
        externalMessageId: "gmail-msg-merge-transfer-1",
      });
      expect(transferRes.outcome).toBe("auto_posted");

      // Both messages resolved to the SAME ledger transaction.
      if (deductionRes.outcome === "auto_posted" && transferRes.outcome === "auto_posted") {
        expect(transferRes.transactionId).toBe(deductionRes.transactionId);
      }

      // The deduction email's authoritative "available balance is AED
      // 1,350.48" is applied exactly once — not decremented a second time
      // by the transfer confirmation, which is what the merge is for.
      const enbd = await db.account.findFirstOrThrow({ where: { userId, type: AccountType.EMIRATES_NBD } });
      expect(enbd.currentBalance.toFixed(2)).toBe("1350.48");

      const allTx = await db.transaction.findMany({ where: { userId } });
      expect(allTx).toHaveLength(1);
      expect(allTx[0].type).toBe("TRANSFER");
      expect(allTx[0].toAccountId).toBe(mashreq.id);

      const updatedMashreq = await db.account.findUniqueOrThrow({ where: { id: mashreq.id } });
      expect(updatedMashreq.currentBalance.toFixed(2)).toBe("150.00");
    });

    it("merges the two emails in the opposite order too (specific transfer confirmation arrives first)", async () => {
      const mashreq = await db.account.create({
        data: { userId, name: "Mashreq", type: AccountType.MASHREQ },
      });

      const base = new Date("2026-03-15T10:00:00Z");

      const transferRes = await importService.processEmail(userId, {
        fromAddress: "OnlineBanking@emiratesnbd.com",
        subject: "Local Bank Transfer",
        body: enbdTransferBody({
          "Debit Amount": "AED 150.00",
          "Channel Reference No": "MERGETEST2",
        }),
        receivedAt: base,
        externalMessageId: "gmail-msg-merge-transfer-2",
      });
      expect(transferRes.outcome).toBe("auto_posted");

      const deductionRes = await importService.processEmail(userId, {
        fromAddress: "OnlineBanking@emiratesnbd.com",
        subject: "Be alert, stay safe.",
        body: "AED 150.00 has been deducted from your account 014XXX70XXX01 for issuance of Telegraphic Transfer. The available balance is AED 1,350.48.",
        receivedAt: new Date(base.getTime() + 8000),
        externalMessageId: "gmail-msg-merge-deduction-2",
      });
      expect(deductionRes.outcome).toBe("auto_posted");

      if (deductionRes.outcome === "auto_posted" && transferRes.outcome === "auto_posted") {
        expect(deductionRes.transactionId).toBe(transferRes.transactionId);
      }

      // The transfer confirmation applies its plain increment first
      // (-150.00), then the deduction email's authoritative balance
      // overwrites it — the correct end state either way, and proof the
      // increment wasn't re-applied a second time on top of it.
      const enbd = await db.account.findFirstOrThrow({ where: { userId, type: AccountType.EMIRATES_NBD } });
      expect(enbd.currentBalance.toFixed(2)).toBe("1350.48");

      const allTx = await db.transaction.findMany({ where: { userId } });
      expect(allTx).toHaveLength(1);
      expect(allTx[0].type).toBe("TRANSFER");
      expect(allTx[0].toAccountId).toBe(mashreq.id);
    });

    it("does not merge two genuinely unrelated transactions that just happen to share an amount, when neither is the generic deduction alert", async () => {
      const base = new Date("2026-03-15T10:00:00Z");

      const first = await importService.processEmail(userId, {
        fromAddress: "OnlineBanking@emiratesnbd.com",
        subject: "Local Bank Transfer",
        body: enbdTransferBody({ "Debit Amount": "AED 150.00", "Channel Reference No": "UNRELATED1" }),
        receivedAt: base,
        externalMessageId: "gmail-msg-unrelated-1",
      });
      expect(first.outcome).toBe("auto_posted");

      const second = await importService.processEmail(userId, {
        fromAddress: "OnlineBanking@emiratesnbd.com",
        subject: "Local Bank Transfer",
        body: enbdTransferBody({ "Debit Amount": "AED 150.00", "Channel Reference No": "UNRELATED2" }),
        receivedAt: new Date(base.getTime() + 8000),
        externalMessageId: "gmail-msg-unrelated-2",
      });
      expect(second.outcome).toBe("auto_posted");

      if (first.outcome === "auto_posted" && second.outcome === "auto_posted") {
        expect(second.transactionId).not.toBe(first.transactionId);
      }

      const allTx = await db.transaction.findMany({ where: { userId } });
      expect(allTx).toHaveLength(2);
    });
  });

  it("a later full balance recompute doesn't double-count the most recent authoritative message's own transaction", async () => {
    // Reproduces a real production bug: an account-deduction alert (has an
    // authoritative "available balance") posts a transaction, then a
    // standalone recompute (the "Recalculate Balances" button, or
    // accountService.updateAllBalances) re-derives currentBalance from
    // latestImportedBalance + everything with createdAt after
    // lastSMSImportedAt. If that message's own Transaction row's createdAt
    // lands even a millisecond after lastSMSImportedAt, the recompute adds
    // its amount a second time on top of a balance that already includes
    // it.
    const res = await importService.processEmail(userId, {
      fromAddress: "OnlineBanking@emiratesnbd.com",
      subject: "Be alert, stay safe.",
      body: "AED 5750.00 has been deducted from your account 014XXX70XXX01 for POS Purchase. The available balance is AED 5750.48.",
      receivedAt: new Date(),
      externalMessageId: "gmail-msg-recompute-race-1",
    });
    expect(res.outcome).toBe("auto_posted");

    const enbdBefore = await db.account.findFirstOrThrow({ where: { userId, type: AccountType.EMIRATES_NBD } });
    expect(enbdBefore.currentBalance.toFixed(2)).toBe("5750.48");

    const recomputed = await accountService.updateAccountBalance(userId, enbdBefore.id);
    expect(recomputed.toFixed(2)).toBe("5750.48");

    const enbdAfter = await db.account.findUniqueOrThrow({ where: { id: enbdBefore.id } });
    expect(enbdAfter.currentBalance.toFixed(2)).toBe("5750.48");
  });
});
