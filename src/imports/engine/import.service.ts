import "server-only";

import { db } from "@/lib/db";
import {
  AuditAction,
  AuditEntityType,
  ImportStatus,
  ImportSource,
  Prisma,
  TransactionType,
  TransactionOrigin,
  CashFlowDirection,
  AccountType,
  ImportConfidence,
  NotificationType,
  NotificationSeverity,
} from "@prisma/client";
import { Decimal } from "decimal.js";
import { sha256, maskSender, redactFinancialText } from "./redaction";
import { smsParserRegistry } from "../sms/parser-registry";
import { buildFingerprint } from "./duplicate-detector";
import { categorizerService } from "../categorizer/categorizer.service";
import { buildImportTransactionData } from "./transaction-builder";
import { accountService } from "../../server/services/account.service";
import { NotificationService } from "../../server/services/notification.service";
import type { NormalizedSmsTransaction } from "../sms/sms-parser.interface";

const DUBAI_OFFSET_HOURS = 4;
const notificationService = new NotificationService();

export interface SmsWebhookPayload {
  sender: string;
  message: string;
  receivedAt: Date;
  deviceId?: string | null;
  idempotencyKey?: string | null;
}

export type ImportResult =
  | { outcome: "processed"; importedTransactionId: string; transactionId: string }
  | { outcome: "review_required"; importedTransactionId: string; parsedAmount: string; currency: string }
  | { outcome: "duplicate"; importedTransactionId: string }
  | { outcome: "rejected"; reason: string }
  | { outcome: "disabled" }
  | { outcome: "idempotent"; importedTransactionId: string }
  | { outcome: "declined"; importedTransactionId: string };

export class ImportService {
  async processSms(userId: string, payload: SmsWebhookPayload): Promise<ImportResult> {
    const { sender, message, receivedAt, idempotencyKey } = payload;

    // ── 1. Load import settings ─────────────────────────────────────────────
    const importSetting = await db.importSetting.findUnique({
      where: { userId },
    });

    if (!importSetting || !importSetting.enabled) {
      return { outcome: "disabled" };
    }

    // ── 2. Idempotency key check (request-level) ────────────────────────────
    if (idempotencyKey) {
      const existing = await db.importedTransaction.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { id: true, status: true, transactionId: true },
      });
      if (existing) {
        return { outcome: "idempotent", importedTransactionId: existing.id };
      }
    }

    // ── 3. Parse ────────────────────────────────────────────────────────────
    const selectionResult = smsParserRegistry.select(
      sender,
      message,
      importSetting.senderAllowlist
    );

    if (selectionResult.outcome === "no_match" || selectionResult.outcome === "ambiguous") {
      const redacted = redactFinancialText(message);
      const payloadHash = sha256(message);
      const maskedSenderValue = maskSender(sender);

      const reason =
        selectionResult.outcome === "ambiguous"
          ? "Ambiguous parsers matched: " + selectionResult.matchedParsers.join(", ")
          : selectionResult.reason;

      await db.auditLog.create({
        data: {
          userId,
          action: AuditAction.SMS_IMPORT_REJECTED,
          entityType: AuditEntityType.IMPORTED_TRANSACTION,
          entityId: "none",
          source: "SMS_WEBHOOK",
          metadata: {
            maskedSender: maskedSenderValue,
            payloadHash,
            redactedMessage: redacted,
            reason,
          },
        },
      });

      return { outcome: "rejected", reason };
    }

    const parser = selectionResult.parser;
    let normalized: NormalizedSmsTransaction;
    try {
      normalized = parser.parse(sender, message, receivedAt);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Parsing execution failed";
      return { outcome: "rejected", reason };
    }

    const maskedSenderValue = maskSender(sender);

    // ── 4. Duplicate fingerprint check ──────────────────────────────────────
    const fingerprint = buildFingerprint(normalized, maskedSenderValue);
    const existingByFingerprint = await db.importedTransaction.findUnique({
      where: { userId_fingerprint: { userId, fingerprint } },
      select: { id: true, status: true },
    });

    if (existingByFingerprint) {
      await db.importedTransaction.update({
        where: { id: existingByFingerprint.id },
        data: {
          duplicateCount: { increment: 1 },
          lastDuplicateAt: new Date(),
        },
      });

      await db.auditLog.create({
        data: {
          userId,
          action: AuditAction.SMS_IMPORT_DUPLICATE,
          entityType: AuditEntityType.IMPORTED_TRANSACTION,
          entityId: existingByFingerprint.id,
          source: "SMS_WEBHOOK",
          metadata: { fingerprint, duplicateCountIncremented: true },
        },
      });

      return { outcome: "duplicate", importedTransactionId: existingByFingerprint.id };
    }

    // ── 4b. Declined Check ──────────────────────────────────────────────────
    if (normalized.isDeclined) {
      const importedTx = await db.$transaction(async (tx) => {
        await accountService.ensureDefaultAccounts(userId, tx);
        const accounts = await tx.account.findMany({ where: { userId } });
        const enbdAcc = accounts.find((a) => a.type === AccountType.EMIRATES_NBD)!;
        const mashreqAcc = accounts.find((a) => a.type === AccountType.MASHREQ)!;
        const primaryAccId = normalized.institution === "Mashreq" ? mashreqAcc.id : enbdAcc.id;

        if (normalized.availableBalance !== null) {
          await tx.account.update({
            where: { id: primaryAccId },
            data: {
              latestImportedBalance: normalized.availableBalance,
              lastSMSImportedAt: receivedAt,
              lastSuccessfulSyncAt: new Date(),
            },
          });
          await accountService.updateAccountBalance(userId, primaryAccId, tx);
        }

        return tx.importedTransaction.create({
          data: {
            source: ImportSource.SMS,
            institution: normalized.institution,
            status: ImportStatus.PROCESSED,
            confidence: normalized.confidence,
            parserKey: normalized.parserKey,
            parserVersion: normalized.parserVersion,
            redactedPayload: normalized.redactedMessage,
            payloadHash: normalized.payloadHash,
            maskedSender: maskedSenderValue,
            parsedAmount: new Prisma.Decimal(normalized.amount.toFixed(2)),
            parsedCurrency: normalized.currency,
            parsedReference: normalized.reference,
            parsedDescription: normalized.description,
            fingerprint,
            receivedAt,
            financialDate: receivedAt,
            idempotencyKey: idempotencyKey ?? null,
            userId,
          },
        });
      });

      await db.auditLog.create({
        data: {
          userId,
          action: AuditAction.SMS_IMPORT_PROCESSED,
          entityType: AuditEntityType.IMPORTED_TRANSACTION,
          entityId: importedTx.id,
          source: "SMS_WEBHOOK",
          metadata: {
            institution: normalized.institution,
            status: "DECLINED",
            message: "Declined transaction; no expense created.",
          },
        },
      });

      return { outcome: "declined", importedTransactionId: importedTx.id };
    }

    // ── 5. Categorize ───────────────────────────────────────────────────────
    const categorizerResult = await categorizerService.resolveCategory(userId, normalized);

    const financialDate = (() => {
      const dubaiMs = normalized.transactionDate.getTime() + DUBAI_OFFSET_HOURS * 60 * 60 * 1000;
      const d = new Date(dubaiMs);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    })();

    // ── 6. Decide: auto-create or review required ───────────────────────────
    const isSalary =
      normalized.transactionType === "INCOME" &&
      (normalized.description.toLowerCase() === "salary" ||
       normalized.parserKey.toLowerCase().includes("salary"));

    // Let's compute it strictly by looking at the rules key:
    const rulesKey = /tabby|butterfly|stiga|tt\s*equipment/i.test(normalized.merchant || "") ? "DEBT" : null;

    let isDebtOverpayment = false;
    if (categorizerResult.resolved && rulesKey === "DEBT") {
      const isTabby = /tabby/i.test(normalized.merchant || "");
      const debtNamePattern = isTabby ? "Tabby" : "Table Tennis Equipment";
      const debt = await db.debt.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          name: { contains: debtNamePattern, mode: "insensitive" },
        },
      });
      if (debt && normalized.amount.greaterThan(debt.currentBalance)) {
        isDebtOverpayment = true;
      }
    }

    // Auto-create: salary needs autoImportSalary=true; others just need enabled=true
    const canAutoCreate =
      (isSalary ? importSetting.autoImportSalary : importSetting.enabled) &&
      normalized.confidence !== ImportConfidence.LOW &&
      categorizerResult.resolved &&
      !isDebtOverpayment;

    if (!canAutoCreate) {
      const failureCode = isDebtOverpayment
        ? "DEBT_OVERPAYMENT"
        : !categorizerResult.resolved
        ? categorizerResult.reason
        : !(isSalary ? importSetting.autoImportSalary : importSetting.enabled)
        ? "AUTO_IMPORT_DISABLED"
        : "LOW_CONFIDENCE";

      const importedTx = await db.importedTransaction.create({
        data: {
          source: ImportSource.SMS,
          institution: normalized.institution,
          status: ImportStatus.REVIEW_REQUIRED,
          confidence: normalized.confidence,
          parserKey: normalized.parserKey,
          parserVersion: normalized.parserVersion,
          redactedPayload: normalized.redactedMessage,
          payloadHash: normalized.payloadHash,
          maskedSender: maskedSenderValue,
          parsedAmount: new Prisma.Decimal(normalized.amount.toFixed(2)),
          parsedCurrency: normalized.currency,
          parsedReference: normalized.reference,
          parsedDescription: normalized.description,
          fingerprint,
          receivedAt,
          financialDate,
          idempotencyKey: idempotencyKey ?? null,
          failureCode,
          userId,
        },
      });

      // Update reported available balance in DB if present!
      const accounts = await db.account.findMany({ where: { userId } });
      const enbdAcc = accounts.find((a) => a.type === AccountType.EMIRATES_NBD)!;
      const mashreqAcc = accounts.find((a) => a.type === AccountType.MASHREQ)!;
      const primaryAccId = normalized.institution === "Mashreq" ? mashreqAcc.id : enbdAcc.id;

      if (normalized.availableBalance !== null) {
        await db.account.update({
          where: { id: primaryAccId },
          data: {
            latestImportedBalance: normalized.availableBalance,
            lastSMSImportedAt: receivedAt,
            lastSuccessfulSyncAt: new Date(),
          },
        });
        await accountService.updateAccountBalance(userId, primaryAccId);
      }

      await db.auditLog.create({
        data: {
          userId,
          action: AuditAction.SMS_IMPORT_RECEIVED,
          entityType: AuditEntityType.IMPORTED_TRANSACTION,
          entityId: importedTx.id,
          source: "SMS_WEBHOOK",
          metadata: {
            institution: normalized.institution,
            parserKey: normalized.parserKey,
            parsedAmount: normalized.amount.toFixed(2),
            status: "REVIEW_REQUIRED",
            reason: failureCode,
          },
        },
      });

      return {
        outcome: "review_required",
        importedTransactionId: importedTx.id,
        parsedAmount: normalized.amount.toFixed(2),
        currency: normalized.currency,
      };
    }

    // ── 7. AUTO-CREATE: atomic Prisma transaction ──────────────────────────
    const categoryId = (categorizerResult as { resolved: true; categoryId: string }).categoryId;

    try {
      const result = await db.$transaction(async (tx) => {
        // Ensure default accounts exist
        await accountService.ensureDefaultAccounts(userId, tx);

        const accounts = await tx.account.findMany({ where: { userId } });
        const enbdAcc = accounts.find((a) => a.type === AccountType.EMIRATES_NBD)!;
        const mashreqAcc = accounts.find((a) => a.type === AccountType.MASHREQ)!;
        const cashAcc = accounts.find((a) => a.type === AccountType.CASH)!;

        // Determine source account
        const primaryAccId =
          normalized.institution === "Mashreq" ? mashreqAcc.id : enbdAcc.id;

        let transactionType: TransactionType = isSalary
          ? TransactionType.INCOME
          : (normalized.transactionType === "TRANSFER" ? TransactionType.TRANSFER : TransactionType.EXPENSE);
        let destAccId: string | null = null;
        let sourceAccId = primaryAccId;

        const isTransfer = transactionType === TransactionType.TRANSFER || /transfer/i.test(normalized.description);
        const isWithdrawal =
          /ATM/i.test(normalized.description) || /withdrawn/i.test(normalized.description);
        const isDebtPayment = normalized.transactionType === "DEBT_PAYMENT" || /tabby|table\s*tennis|butterfly|stiga|tt\s*equipment/i.test(
          normalized.merchant || ""
        );
        const isRemittance = normalized.transactionType === "REMITTANCE" || /taptap\s*send/i.test(normalized.merchant || "");

        if (isTransfer) {
          transactionType = TransactionType.TRANSFER;
          if (normalized.institution === "Emirates NBD") {
            sourceAccId = enbdAcc.id;
            destAccId = mashreqAcc.id;
          } else if (normalized.institution === "Mashreq") {
            if (/received|credited|from/i.test(normalized.redactedMessage || "")) {
              sourceAccId = enbdAcc.id;
              destAccId = mashreqAcc.id;
            } else {
              sourceAccId = mashreqAcc.id;
              destAccId = enbdAcc.id;
            }
          }
        } else if (isWithdrawal) {
          transactionType = TransactionType.TRANSFER;
          sourceAccId = primaryAccId;
          destAccId = cashAcc.id;
        } else if (isDebtPayment) {
          transactionType = TransactionType.DEBT_PAYMENT;
        } else if (isRemittance) {
          transactionType = TransactionType.REMITTANCE;
        }

        // Check if an existing internal transfer exists to deduplicate
        let existingTransferTxId: string | null = null;
        if (transactionType === TransactionType.TRANSFER && destAccId && destAccId !== cashAcc.id) {
          const duplicateTransfer = await tx.transaction.findFirst({
            where: {
              userId,
              type: TransactionType.TRANSFER,
              amount: { equals: normalized.amount },
              accountId: sourceAccId,
              toAccountId: destAccId,
              date: {
                gte: new Date(receivedAt.getTime() - 10 * 60 * 1000), // Within 10 mins
                lte: new Date(receivedAt.getTime() + 10 * 60 * 1000),
              },
            },
            select: { id: true },
          });
          if (duplicateTransfer) {
            existingTransferTxId = duplicateTransfer.id;
          }
        }

        if (existingTransferTxId) {
          if (normalized.availableBalance !== null) {
            await tx.account.update({
              where: { id: primaryAccId },
              data: {
                latestImportedBalance: normalized.availableBalance,
                lastSMSImportedAt: receivedAt,
                lastSuccessfulSyncAt: new Date(),
              },
            });
          }
          await accountService.updateAccountBalance(userId, sourceAccId, tx);
          await accountService.updateAccountBalance(userId, destAccId!, tx);

          const importedTx = await tx.importedTransaction.create({
            data: {
              source: ImportSource.SMS,
              institution: normalized.institution,
              status: ImportStatus.PROCESSED,
              confidence: normalized.confidence,
              parserKey: normalized.parserKey,
              parserVersion: normalized.parserVersion,
              redactedPayload: normalized.redactedMessage,
              payloadHash: normalized.payloadHash,
              maskedSender: maskedSenderValue,
              parsedAmount: new Prisma.Decimal(normalized.amount.toFixed(2)),
              parsedCurrency: normalized.currency,
              parsedReference: normalized.reference,
              parsedDescription: normalized.description,
              fingerprint,
              receivedAt,
              financialDate,
              idempotencyKey: idempotencyKey ?? null,
              userId,
              processedAt: new Date(),
            },
          });

          await tx.importSetting.update({
            where: { userId },
            data: { lastSuccessfulImportAt: new Date() },
          });

          return { importedTxId: importedTx.id, ledgerTxId: existingTransferTxId };
        }

        const txData = buildImportTransactionData(normalized, categoryId, {
          type: transactionType,
          accountId: sourceAccId,
          toAccountId: destAccId,
        });

        // Create ImportedTransaction record as PROCESSING
        const importedTx = await tx.importedTransaction.create({
          data: {
            source: ImportSource.SMS,
            institution: normalized.institution,
            status: ImportStatus.PROCESSING,
            confidence: normalized.confidence,
            parserKey: normalized.parserKey,
            parserVersion: normalized.parserVersion,
            redactedPayload: normalized.redactedMessage,
            payloadHash: normalized.payloadHash,
            maskedSender: maskedSenderValue,
            parsedAmount: new Prisma.Decimal(normalized.amount.toFixed(2)),
            parsedCurrency: normalized.currency,
            parsedReference: normalized.reference,
            parsedDescription: normalized.description,
            fingerprint,
            receivedAt,
            financialDate,
            idempotencyKey: idempotencyKey ?? null,
            userId,
          },
        });

        let ledgerTxId: string;

        if (transactionType === TransactionType.DEBT_PAYMENT) {
          const isTabby = /tabby/i.test(normalized.merchant || "");
          const debtNamePattern = isTabby ? "Tabby" : "Table Tennis Equipment";

          const debt = await tx.debt.findFirst({
            where: {
              userId,
              status: "ACTIVE",
              name: { contains: debtNamePattern, mode: "insensitive" },
            },
          });

          if (!debt) {
            throw new Error(`DEBT_NOT_FOUND: Active debt for ${debtNamePattern} not found.`);
          }

          const balanceBefore = debt.currentBalance;
          const balanceAfter = Decimal.max(0, balanceBefore.minus(normalized.amount));
          const isZero = balanceAfter.isZero();
          const newStatus = isZero ? "PAID" : debt.status;

          const ledgerTx = await tx.transaction.create({
            data: {
              userId,
              date: txData.date,
              categoryId: debt.categoryId!,
              description: `Payment to debt: ${debt.name}`,
              amount: txData.amount,
              paymentMethod: txData.paymentMethod,
              notes: txData.notes,
              type: TransactionType.DEBT_PAYMENT,
              cashFlowDirection: CashFlowDirection.OUTFLOW,
              origin: TransactionOrigin.SMS_IMPORT,
              accountId: mashreqAcc.id,
            },
          });

          await tx.debtPayment.create({
            data: {
              userId,
              debtId: debt.id,
              amount: txData.amount,
              balanceBefore,
              balanceAfter,
              paymentDate: txData.date,
              notes: "Automated link from debt payment",
              transactionId: ledgerTx.id,
            },
          });

          await tx.debt.update({
            where: { id: debt.id },
            data: { currentBalance: balanceAfter, status: newStatus },
          });

          if (isZero) {
            // Fire notification after transaction commits
            await notificationService.createNotificationIdempotent(userId, {
              type: NotificationType.DEBT_PAID_OFF,
              title: "Debt Paid Off",
              message: `${debt.name} has been fully paid off!`,
              severity: NotificationSeverity.INFO,
              eventKey: `debt-paid-${debt.id}`,
            });
          }

          ledgerTxId = ledgerTx.id;
        } else if (transactionType === TransactionType.REMITTANCE) {
          const totalOutflow = normalized.amount;

          const ledgerTx = await tx.transaction.create({
            data: {
              userId,
              date: txData.date,
              categoryId,
              description: "Remittance via TapTap Send",
              amount: totalOutflow,
              paymentMethod: "TapTap Send",
              notes: txData.notes,
              type: TransactionType.REMITTANCE,
              cashFlowDirection: CashFlowDirection.OUTFLOW,
              origin: TransactionOrigin.SMS_IMPORT,
              accountId: mashreqAcc.id,
            },
          });

          await tx.remittance.create({
            data: {
              userId,
              recipient: null,
              amountSentAed: normalized.amount,
              cashOutflowAed: totalOutflow,
              exchangeRate: null,
              amountReceivedPhp: null,
              transferFeeAed: null,
              transferProvider: "TapTap Send",
              transferDate: txData.date,
              transactionId: ledgerTx.id,
              categoryId,
              status: "COMPLETED",
            },
          });

          ledgerTxId = ledgerTx.id;
        } else {
          // Regular income, expense, or transfer
          const ledgerTx = await tx.transaction.create({
            data: {
              date: txData.date,
              categoryId: txData.categoryId,
              description: txData.description,
              amount: txData.amount,
              paymentMethod: txData.paymentMethod,
              notes: txData.notes,
              type: txData.type,
              cashFlowDirection: txData.cashFlowDirection,
              importSource: txData.importSource,
              origin: txData.origin,
              accountId: txData.accountId,
              toAccountId: txData.toAccountId,
              userId,
            },
          });

          ledgerTxId = ledgerTx.id;
        }

        // Link transaction to imported record
        await tx.importedTransaction.update({
          where: { id: importedTx.id },
          data: {
            transactionId: ledgerTxId,
            status: ImportStatus.PROCESSED,
            processedAt: new Date(),
          },
        });

        await tx.importSetting.update({
          where: { userId },
          data: { lastSuccessfulImportAt: new Date() },
        });

        // Update SMS sync timestamps and latestImportedBalance on primary account
        if (normalized.availableBalance !== null) {
          await tx.account.update({
            where: { id: primaryAccId },
            data: {
              latestImportedBalance: normalized.availableBalance,
              lastSMSImportedAt: receivedAt,
              lastSuccessfulSyncAt: new Date(),
            },
          });
        } else {
          await tx.account.update({
            where: { id: primaryAccId },
            data: {
              lastSuccessfulSyncAt: new Date(),
            },
          });
        }

        // Update account balances
        await accountService.updateAccountBalance(userId, sourceAccId, tx);
        if (destAccId) {
          await accountService.updateAccountBalance(userId, destAccId, tx);
        }

        await tx.auditLog.create({
          data: {
            userId,
            action: AuditAction.SMS_IMPORT_PROCESSED,
            entityType: AuditEntityType.IMPORTED_TRANSACTION,
            entityId: importedTx.id,
            source: "SMS_WEBHOOK",
            metadata: {
              institution: normalized.institution,
              parserKey: normalized.parserKey,
              parsedAmount: normalized.amount.toFixed(2),
              transactionId: ledgerTxId,
            },
          },
        });

        return { importedTxId: importedTx.id, ledgerTxId };
      });

      return {
        outcome: "processed",
        importedTransactionId: result.importedTxId,
        transactionId: result.ledgerTxId,
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await db.importedTransaction.findUnique({
          where: { userId_fingerprint: { userId, fingerprint } },
          select: { id: true },
        });
        return {
          outcome: "duplicate",
          importedTransactionId: existing?.id ?? "unknown",
        };
      }

      const failedRecord = await db.importedTransaction.findFirst({
        where: { userId, fingerprint },
        select: { id: true },
      });
      if (failedRecord) {
        await db.importedTransaction.update({
          where: { id: failedRecord.id },
          data: {
            status: ImportStatus.FAILED,
            failureCode: "TRANSACTION_CREATION_FAILED",
            failureMessage:
              err instanceof Error ? err.message : "Unknown failure during import.",
          },
        });
      }
      throw err;
    }
  }

  async confirmImport(
    userId: string,
    importedTransactionId: string,
    overrides?: { categoryId?: string; financialDate?: Date }
  ): Promise<{ transactionId: string }> {
    const importedTx = await db.importedTransaction.findUnique({
      where: { id: importedTransactionId },
    });

    if (!importedTx) throw new Error("IMPORT_NOT_FOUND");
    if (importedTx.userId !== userId) throw new Error("IMPORT_NOT_OWNED");
    if (importedTx.status !== ImportStatus.REVIEW_REQUIRED) {
      throw new Error(`IMPORT_CANNOT_CONFIRM: status is ${importedTx.status}`);
    }
    if (!importedTx.parsedAmount) throw new Error("IMPORT_NO_AMOUNT");

    const isSalary =
      importedTx.parsedDescription?.toLowerCase() === "salary" ||
      importedTx.parserKey?.toLowerCase().includes("salary");

    const normalized: NormalizedSmsTransaction = {
      source: "SMS",
      institution: importedTx.institution,
      parserKey: importedTx.parserKey || "",
      parserVersion: importedTx.parserVersion || "",
      transactionType: isSalary ? "INCOME" : "EXPENSE",
      amount: new Decimal(importedTx.parsedAmount.toString()),
      currency: importedTx.parsedCurrency || "AED",
      merchant: !isSalary ? (importedTx.parsedDescription || "Unknown") : null,
      description: importedTx.parsedDescription || "",
      reference: importedTx.parsedReference || null,
      transactionDate: overrides?.financialDate || importedTx.financialDate || importedTx.receivedAt,
      redactedMessage: importedTx.redactedPayload || "",
      payloadHash: importedTx.payloadHash,
      confidence: importedTx.confidence || ImportConfidence.MEDIUM,
      availableBalance: null,
      accountEnding: null,
      isDeclined: false,
      metadata: {},
    };

    const { transactionId } = await db.$transaction(async (tx) => {
      await accountService.ensureDefaultAccounts(userId, tx);

      const accounts = await tx.account.findMany({ where: { userId } });
      const enbdAcc = accounts.find((a) => a.type === AccountType.EMIRATES_NBD)!;
      const mashreqAcc = accounts.find((a) => a.type === AccountType.MASHREQ)!;
      const cashAcc = accounts.find((a) => a.type === AccountType.CASH)!;

      const primaryAccId =
        normalized.institution === "Mashreq" ? mashreqAcc.id : enbdAcc.id;

      let transactionType: TransactionType = isSalary
        ? TransactionType.INCOME
        : TransactionType.EXPENSE;
      let destAccId: string | null = null;

      const isTransfer = /transfer/i.test(normalized.description);
      const isWithdrawal =
        /ATM/i.test(normalized.description) || /withdrawn/i.test(normalized.description);
      const isDebtPayment = /tabby|table\s*tennis|butterfly|stiga|tt\s*equipment/i.test(
        normalized.merchant || ""
      );
      const isRemittance = /taptap\s*send/i.test(normalized.merchant || "");

      if (isTransfer) {
        transactionType = TransactionType.TRANSFER;
        destAccId = mashreqAcc.id;
      } else if (isWithdrawal) {
        transactionType = TransactionType.TRANSFER;
        destAccId = cashAcc.id;
      } else if (isDebtPayment) {
        transactionType = TransactionType.DEBT_PAYMENT;
      } else if (isRemittance) {
        transactionType = TransactionType.REMITTANCE;
      }

      // Mark PROCESSING to prevent double-confirmation
      await tx.importedTransaction.update({
        where: { id: importedTx.id },
        data: { status: ImportStatus.PROCESSING },
      });

      // Resolve category
      let resolvedCategoryId: string;
      if (overrides?.categoryId) {
        resolvedCategoryId = overrides.categoryId;
      } else {
        const catRes = await categorizerService.resolveCategory(userId, normalized);
        if (catRes.resolved) {
          resolvedCategoryId = catRes.categoryId;
        } else {
          const uncategorized = await tx.category.findFirst({
            where: { userId, name: { equals: "Uncategorized", mode: "insensitive" } },
          });
          resolvedCategoryId = uncategorized!.id;
        }
      }

      const txData = buildImportTransactionData(normalized, resolvedCategoryId, {
        type: transactionType,
        accountId: primaryAccId,
        toAccountId: destAccId,
      });

      let ledgerTxId: string;

      if (transactionType === TransactionType.DEBT_PAYMENT) {
        const isTabby = /tabby/i.test(normalized.merchant || "");
        const debtNamePattern = isTabby ? "Tabby" : "Table Tennis Equipment";

        const debt = await tx.debt.findFirst({
          where: {
            userId,
            status: "ACTIVE",
            name: { contains: debtNamePattern, mode: "insensitive" },
          },
        });

        if (!debt) {
          throw new Error(`DEBT_NOT_FOUND: Active debt for ${debtNamePattern} not found.`);
        }

        const balanceBefore = debt.currentBalance;
        if (normalized.amount.greaterThan(balanceBefore)) {
          throw new Error(`DEBT_OVERPAYMENT: Payment of AED ${normalized.amount.toFixed(2)} exceeds remaining debt balance of AED ${balanceBefore.toFixed(2)}.`);
        }
        const balanceAfter = balanceBefore.minus(normalized.amount);
        const isZero = balanceAfter.isZero();
        const newStatus = isZero ? "PAID" : debt.status;

        const ledgerTx = await tx.transaction.create({
          data: {
            userId,
            date: txData.date,
            categoryId: debt.categoryId!,
            description: `Payment to debt: ${debt.name}`,
            amount: txData.amount,
            paymentMethod: txData.paymentMethod,
            notes: txData.notes,
            type: TransactionType.DEBT_PAYMENT,
            cashFlowDirection: CashFlowDirection.OUTFLOW,
            origin: TransactionOrigin.SMS_IMPORT,
            accountId: mashreqAcc.id,
          },
        });

        await tx.debtPayment.create({
          data: {
            userId,
            debtId: debt.id,
            amount: txData.amount,
            balanceBefore,
            balanceAfter,
            paymentDate: txData.date,
            notes: "Automated link from debt payment",
            transactionId: ledgerTx.id,
          },
        });

        await tx.debt.update({
          where: { id: debt.id },
          data: { currentBalance: balanceAfter, status: newStatus },
        });

        if (isZero) {
          await notificationService.createNotificationIdempotent(userId, {
            type: NotificationType.DEBT_PAID_OFF,
            title: "Debt Paid Off",
            message: `${debt.name} has been fully paid off!`,
            severity: NotificationSeverity.INFO,
            eventKey: `debt-paid-${debt.id}`,
          });
        }

        ledgerTxId = ledgerTx.id;
      } else if (transactionType === TransactionType.REMITTANCE) {
        const totalOutflow = normalized.amount;

        const ledgerTx = await tx.transaction.create({
          data: {
            userId,
            date: txData.date,
            categoryId: resolvedCategoryId,
            description: "Remittance via TapTap Send",
            amount: totalOutflow,
            paymentMethod: "TapTap Send",
            notes: txData.notes,
            type: TransactionType.REMITTANCE,
            cashFlowDirection: CashFlowDirection.OUTFLOW,
            origin: TransactionOrigin.SMS_IMPORT,
            accountId: mashreqAcc.id,
          },
        });

        await tx.remittance.create({
          data: {
            userId,
            recipient: null,
            amountSentAed: normalized.amount,
            cashOutflowAed: totalOutflow,
            exchangeRate: null,
            amountReceivedPhp: null,
            transferFeeAed: null,
            transferProvider: "TapTap Send",
            transferDate: txData.date,
            transactionId: ledgerTx.id,
            categoryId: resolvedCategoryId,
            status: "COMPLETED",
          },
        });

        ledgerTxId = ledgerTx.id;
      } else {
        const ledgerTx = await tx.transaction.create({
          data: {
            date: txData.date,
            categoryId: txData.categoryId,
            description: txData.description,
            amount: txData.amount,
            paymentMethod: txData.paymentMethod,
            notes: txData.notes,
            type: txData.type,
            cashFlowDirection: txData.cashFlowDirection,
            importSource: txData.importSource,
            origin: txData.origin,
            accountId: txData.accountId,
            toAccountId: txData.toAccountId,
            userId,
          },
        });

        ledgerTxId = ledgerTx.id;
      }

      await tx.importedTransaction.update({
        where: { id: importedTx.id },
        data: {
          transactionId: ledgerTxId,
          status: ImportStatus.PROCESSED,
          processedAt: new Date(),
          reviewedAt: new Date(),
        },
      });

      await tx.importSetting.updateMany({
        where: { userId },
        data: { lastSuccessfulImportAt: new Date() },
      });

      await accountService.updateAccountBalance(userId, primaryAccId, tx);
      if (destAccId) {
        await accountService.updateAccountBalance(userId, destAccId, tx);
      }

      await tx.account.update({
        where: { id: primaryAccId },
        data: { lastSuccessfulSyncAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.IMPORT_CONFIRMED,
          entityType: AuditEntityType.IMPORTED_TRANSACTION,
          entityId: importedTx.id,
          source: "WEB",
          metadata: {
            institution: importedTx.institution,
            parserKey: importedTx.parserKey,
            parsedAmount: importedTx.parsedAmount?.toString(),
            parsedCurrency: importedTx.parsedCurrency,
            transactionId: ledgerTxId,
          },
        },
      });

      return { transactionId: ledgerTxId };
    });

    return { transactionId };
  }

  async rejectImport(userId: string, importedTransactionId: string): Promise<void> {
    const importedTx = await db.importedTransaction.findUnique({
      where: { id: importedTransactionId },
      select: { id: true, userId: true, status: true, institution: true, parserKey: true },
    });

    if (!importedTx) throw new Error("IMPORT_NOT_FOUND");
    if (importedTx.userId !== userId) throw new Error("IMPORT_NOT_OWNED");
    if (importedTx.status !== ImportStatus.REVIEW_REQUIRED) {
      throw new Error(`IMPORT_CANNOT_REJECT: status is ${importedTx.status}`);
    }

    await db.$transaction(async (tx) => {
      await tx.importedTransaction.update({
        where: { id: importedTx.id },
        data: { status: ImportStatus.REJECTED, reviewedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.IMPORT_REJECTED_MANUAL,
          entityType: AuditEntityType.IMPORTED_TRANSACTION,
          entityId: importedTx.id,
          source: "WEB",
          metadata: { institution: importedTx.institution, parserKey: importedTx.parserKey },
        },
      });
    });
  }
}

export const importService = new ImportService();
