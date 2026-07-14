import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { accountService } from "../../src/server/services/account.service";
import { emiratesNBDParser } from "../../src/imports/sms/emirates-nbd.parser";
import { mashreqParser } from "../../src/imports/sms/mashreq.parser";
import { categorizerService } from "../../src/imports/categorizer/categorizer.service";
import { TransactionService } from "../../src/server/services/transaction.service";
import { AccountType, TransactionType, ImportConfidence } from "@prisma/client";
import { Decimal } from "decimal.js";

// Import directly from the engine
import { importService as actualImportService } from "../../src/imports/engine/import.service";

const transactionService = new TransactionService();

describe("Milestone 7.2 — Personal Finance Automation Workflow", () => {
  let userId: string;

  beforeEach(async () => {
    // 1. Clean tables
    await db.debtPayment.deleteMany({});
    await db.debt.deleteMany({});
    await db.remittance.deleteMany({});
    await db.transaction.deleteMany({});
    await db.category.deleteMany({});
    await db.account.deleteMany({});
    await db.user.deleteMany({});

    // 2. Create seed user
    const user = await db.user.create({
      data: {
        email: "m72_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "M72 Tester",
      },
    });
    userId = user.id;

    // 3. Create default settings
    await db.setting.create({
      data: {
        userId,
        monthlySalary: 5750.00,
        payday: 25,
      },
    });

    // 4. Provision standard categories
    const categoriesData = [
      { name: "Salary", type: "INCOME" },
      { name: "Transfers", type: "VARIABLE_EXPENSE" },
      { name: "Rent Cash", type: "VARIABLE_EXPENSE" },
      { name: "Transportation", type: "VARIABLE_EXPENSE" },
      { name: "Groceries", type: "VARIABLE_EXPENSE" },
      { name: "Uncategorized", type: "VARIABLE_EXPENSE" },
      { name: "Tabby Payment", type: "DEBT" },
      { name: "Table Tennis Payment", type: "DEBT" },
      { name: "Remittance", type: "REMITTANCE" },
    ];

    for (const cat of categoriesData) {
      await db.category.create({
        data: {
          userId,
          name: cat.name,
          type: cat.type as any,
        },
      });
    }

    // 5. Provision default accounts
    await accountService.ensureDefaultAccounts(userId);

    // 6. Provision settings for auto import
    await db.importSetting.create({
      data: {
        userId,
        enabled: true,
        autoImportSalary: true,
        senderAllowlist: ["ENBD", "MASHREQ"],
      },
    });
  });

  describe("Account Provisioning & Dynamic Balance Derivation", () => {
    it("provisions Emirates NBD, Mashreq, and Cash with 0.00 starting balances", async () => {
      const accounts = await accountService.getAccounts(userId);
      expect(accounts).toHaveLength(3);
      
      const enbd = accounts.find((a) => a.type === AccountType.EMIRATES_NBD);
      const mashreq = accounts.find((a) => a.type === AccountType.MASHREQ);
      const cash = accounts.find((a) => a.type === AccountType.CASH);

      expect(enbd).toBeDefined();
      expect(mashreq).toBeDefined();
      expect(cash).toBeDefined();

      expect(enbd!.currentBalance.toFixed(2)).toBe("0.00");
      expect(mashreq!.currentBalance.toFixed(2)).toBe("0.00");
      expect(cash!.currentBalance.toFixed(2)).toBe("0.00");
    });

    it("calculates dynamic balance as Inflows - Outflows", async () => {
      const accounts = await accountService.getAccounts(userId);
      const enbd = accounts.find((a) => a.type === AccountType.EMIRATES_NBD)!;
      const mashreq = accounts.find((a) => a.type === AccountType.MASHREQ)!;

      const salaryCat = await db.category.findFirst({ where: { userId, name: "Salary" } });
      const transferCat = await db.category.findFirst({ where: { userId, name: "Transfers" } });

      // Create inflow: Salary (AED 5,750) to ENBD
      await transactionService.createTransaction(userId, {
        date: new Date(),
        categoryId: salaryCat!.id,
        description: "Salary credit",
        amount: new Decimal("5750.00"),
        paymentMethod: "SMS Import",
        type: TransactionType.INCOME,
        accountId: enbd.id,
      });

      // Recalculate and assert
      let enbdBal = await accountService.updateAccountBalance(userId, enbd.id);
      expect(enbdBal.toFixed(2)).toBe("5750.00");

      // Create outflow: Transfer (AED 3,750) from ENBD to Mashreq
      await transactionService.createTransaction(userId, {
        date: new Date(),
        categoryId: transferCat!.id,
        description: "Transfer to Mashreq",
        amount: new Decimal("3750.00"),
        paymentMethod: "SMS Import",
        type: TransactionType.TRANSFER,
        accountId: enbd.id,
        toAccountId: mashreq.id,
      });

      enbdBal = await accountService.updateAccountBalance(userId, enbd.id);
      const mashreqBal = await accountService.updateAccountBalance(userId, mashreq.id);

      expect(enbdBal.toFixed(2)).toBe("2000.00"); // 5750 - 3750
      expect(mashreqBal.toFixed(2)).toBe("3750.00"); // +3750 inflow
    });
  });

  describe("Emirates NBD Parser Rules", () => {
    it("parses Salary credit dynamically", () => {
      const msg = "AED 5,750.00 has been credited to your account no. 014XXX70XXX01 DTB SALARY TR REF EPHCOP1810A4BEZH 2229XXX62XXX-19. The available balance is AED 5,752.56.";
      const res = emiratesNBDParser.parse("ENBD", msg, new Date());
      expect(res.transactionType).toBe("INCOME");
      expect(res.amount.toFixed(2)).toBe("5750.00");
      expect(res.reference).toBe("EPHCOP1810A4BEZH");
    });

    it("parses Internal Transfer dynamically", () => {
      const msg = "Dear Customer, your transfer of AED 3,750.00 to Mashreq account ending 1234 was successful. Ref: TRF123456.";
      const res = emiratesNBDParser.parse("ENBD", msg, new Date());
      expect(res.transactionType).toBe("EXPENSE");
      expect(res.merchant).toBe("Mashreq");
      expect(res.amount.toFixed(2)).toBe("3750.00");
      expect(res.reference).toBe("TRF123456");
    });

    it("parses ATM Cash Withdrawal dynamically", () => {
      const msg = "Dear Customer, AED 2,000.00 has been withdrawn from your account ending 01 at ATM. Ref: ATM888999.";
      const res = emiratesNBDParser.parse("ENBD", msg, new Date());
      expect(res.transactionType).toBe("EXPENSE");
      expect(res.merchant).toBe("ATM");
      expect(res.amount.toFixed(2)).toBe("2000.00");
      expect(res.reference).toBe("ATM888999");
    });
  });

  describe("Mashreq Parser & Rules Engine Mapping", () => {
    it("parses Tabby Debt Payment and maps to DEBT", async () => {
      const msg = "AED 500.00 debited from card ending 1234 at TABBY UAE on 11-07-2026. Ref: TXN9992";
      const parsed = mashreqParser.parse("MASHREQ", msg, new Date());
      expect(parsed.amount.toFixed(2)).toBe("500.00");
      expect(parsed.merchant).toBe("TABBY"); // MashreqParser normalizes "TABBY UAE" to "TABBY" if it detects TABBY

      const catRes = await categorizerService.resolveCategory(userId, parsed);
      const tabbyCat = await db.category.findFirst({ where: { userId, name: "Tabby Payment" } });
      await db.debt.create({
        data: {
          userId,
          name: "Tabby",
          originalBalance: 8284.58,
          currentBalance: 8284.58,
          monthlyPayment: 500.00,
          dueDay: 25,
          rolloverFeeRate: 4.50,
          categoryId: tabbyCat!.id,
        },
      });

      const catResWithDebt = await categorizerService.resolveCategory(userId, parsed);
      expect(catResWithDebt.resolved).toBe(true);
      if (catResWithDebt.resolved) {
        expect(catResWithDebt.categoryId).toBe(tabbyCat!.id);
      }
    });

    it("parses Table Tennis payment with aliases", async () => {
      const msg = "AED 150.00 debited from card ending 1234 at BUTTERFLY TT on 11-07-2026. Ref: TXN1112";
      const parsed = mashreqParser.parse("MASHREQ", msg, new Date());
      expect(parsed.merchant).toBe("BUTTERFLY TT");

      const ttCat = await db.category.findFirst({ where: { userId, name: "Table Tennis Payment" } });
      await db.debt.create({
        data: {
          userId,
          name: "Table Tennis Equipment",
          originalBalance: 600.00,
          currentBalance: 600.00,
          monthlyPayment: 150.00,
          dueDay: 15,
          rolloverFeeRate: 0.00,
          categoryId: ttCat!.id,
        },
      });

      const catRes = await categorizerService.resolveCategory(userId, parsed);
      expect(catRes.resolved).toBe(true);
      if (catRes.resolved) {
        expect(catRes.categoryId).toBe(ttCat!.id);
      }
    });

    it("parses RTA NOL top-up as Transportation expense", async () => {
      const msg = "Your Mashreq card ending 1234 was used for AED 400.00 at RTA NOL on 11/07/2026. Ref: RTA123";
      const parsed = mashreqParser.parse("MASHREQ", msg, new Date());
      expect(parsed.amount.toFixed(2)).toBe("400.00");
      expect(parsed.merchant).toBe("RTA NOL");

      const catRes = await categorizerService.resolveCategory(userId, parsed);
      const transportCat = await db.category.findFirst({ where: { userId, name: "Transportation" } });
      expect(catRes.resolved).toBe(true);
      if (catRes.resolved) {
        expect(catRes.categoryId).toBe(transportCat!.id);
      }
    });

    it("parses TapTap Send as Remittance", async () => {
      const msg = "Your Mashreq card ending 1234 was used for AED 700.00 at TAPTAP SEND on 11/07/2026. Ref: TT777";
      const parsed = mashreqParser.parse("MASHREQ", msg, new Date());
      expect(parsed.amount.toFixed(2)).toBe("700.00");
      expect(parsed.merchant).toBe("TAPTAP SEND");

      const catRes = await categorizerService.resolveCategory(userId, parsed);
      const remittanceCat = await db.category.findFirst({ where: { userId, name: "Remittance" } });
      expect(catRes.resolved).toBe(true);
      if (catRes.resolved) {
        expect(catRes.categoryId).toBe(remittanceCat!.id);
      }
    });
  });

  describe("Import Engine Hardening: Automated Workflow Checks", () => {
    it("automatically routes Mashreq spending to review when unverified, and processes after manual confirmation", async () => {
      const msg = "Your Mashreq card ending 1234 was used for AED 120.00 at CARREFOUR on 11/07/2026. Ref: CR888";
      const res = await actualImportService.processSms(userId, {
        sender: "MASHREQ",
        message: msg,
        receivedAt: new Date(),
      });

      expect(res.outcome).toBe("review_required");
      const review = res as { outcome: "review_required"; importedTransactionId: string };

      // Manually confirm import
      const confirmRes = await actualImportService.confirmImport(userId, review.importedTransactionId);
      expect(confirmRes.transactionId).toBeDefined();
      
      // Verify transaction was created in ledger
      const tx = await db.transaction.findUnique({
        where: { id: confirmRes.transactionId },
      });
      expect(tx).toBeDefined();
      expect(tx!.amount.toFixed(2)).toBe("120.00");

      // Verify Mashreq account balance was updated
      const accounts = await accountService.getAccounts(userId);
      const mashreq = accounts.find((a) => a.type === AccountType.MASHREQ)!;
      expect(mashreq.currentBalance.toFixed(2)).toBe("-120.00"); // 0 - 120
    });

    it("automatically routes internal transfers and ATM cash withdrawals to review, and processes after manual confirmation", async () => {
      // 1. Inflow of 5,750
      const enbd = (await accountService.getAccounts(userId)).find(a => a.type === AccountType.EMIRATES_NBD)!;
      const salaryCat = await db.category.findFirst({ where: { userId, name: "Salary" } });
      await transactionService.createTransaction(userId, {
        date: new Date(),
        categoryId: salaryCat!.id,
        description: "Salary credit",
        amount: new Decimal("5750.00"),
        paymentMethod: "SMS Import",
        type: TransactionType.INCOME,
        accountId: enbd.id,
      });

      // 2. Transfer of 3,750 ENBD -> Mashreq
      const msgTransfer = "Dear Customer, your transfer of AED 3,750.00 to Mashreq account ending 1234 was successful. Ref: TRF11";
      const resTransfer = await actualImportService.processSms(userId, {
        sender: "ENBD",
        message: msgTransfer,
        receivedAt: new Date(),
      });
      expect(resTransfer.outcome).toBe("review_required");
      const reviewTransfer = resTransfer as { outcome: "review_required"; importedTransactionId: string };
      const confirmTransfer = await actualImportService.confirmImport(userId, reviewTransfer.importedTransactionId);
      expect(confirmTransfer.transactionId).toBeDefined();

      // 3. ATM withdrawal of 2,000 ENBD -> Cash
      const msgWithdrawal = "Dear Customer, AED 2,000.00 has been withdrawn from your account ending 01 at ATM. Ref: ATM11";
      const resWithdrawal = await actualImportService.processSms(userId, {
        sender: "ENBD",
        message: msgWithdrawal,
        receivedAt: new Date(),
      });
      expect(resWithdrawal.outcome).toBe("review_required");
      const reviewWithdrawal = resWithdrawal as { outcome: "review_required"; importedTransactionId: string };
      const confirmWithdrawal = await actualImportService.confirmImport(userId, reviewWithdrawal.importedTransactionId);
      expect(confirmWithdrawal.transactionId).toBeDefined();

      // 4. Verify balances
      const accounts = await accountService.getAccounts(userId);
      const enbdFinal = accounts.find(a => a.type === AccountType.EMIRATES_NBD)!;
      const mashreqFinal = accounts.find(a => a.type === AccountType.MASHREQ)!;
      const cashFinal = accounts.find(a => a.type === AccountType.CASH)!;

      expect(enbdFinal.currentBalance.toFixed(2)).toBe("0.00");
      expect(mashreqFinal.currentBalance.toFixed(2)).toBe("3750.00");
      expect(cashFinal.currentBalance.toFixed(2)).toBe("2000.00");
    });

    it("routes debt payment to review when unverified, and marks PAID after manual confirmation", async () => {
      const tabbyCat = await db.category.findFirst({ where: { userId, name: "Tabby Payment" } });
      const debt = await db.debt.create({
        data: {
          userId,
          name: "Tabby",
          originalBalance: 500.00,
          currentBalance: 500.00,
          monthlyPayment: 500.00,
          dueDay: 25,
          rolloverFeeRate: 0.00,
          categoryId: tabbyCat!.id,
        },
      });

      const msg = "AED 500.00 debited from card ending 1234 at TABBY UAE on 11-07-2026. Ref: TXN9992";
      const res = await actualImportService.processSms(userId, {
        sender: "MASHREQ",
        message: msg,
        receivedAt: new Date(),
      });
      expect(res.outcome).toBe("review_required");
      const review = res as { outcome: "review_required"; importedTransactionId: string };
      
      const confirmRes = await actualImportService.confirmImport(userId, review.importedTransactionId);
      expect(confirmRes.transactionId).toBeDefined();

      // Verify debt is PAID
      const updatedDebt = await db.debt.findUnique({ where: { id: debt.id } });
      expect(updatedDebt!.currentBalance.toFixed(2)).toBe("0.00");
      expect(updatedDebt!.status).toBe("PAID");

      // Verify notification generated
      const notifications = await db.notification.findMany({ where: { userId } });
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0].title).toContain("Debt Paid Off");
    });
  });
});
