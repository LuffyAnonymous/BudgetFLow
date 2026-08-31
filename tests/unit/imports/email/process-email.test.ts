import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { importService } from "@/imports/engine/import.service";
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
});
