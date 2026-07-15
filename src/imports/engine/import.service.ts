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
import { accountService } from "../../server/services/account.service";
import { NotificationService } from "../../server/services/notification.service";
import type { NormalizedSmsTransaction } from "../sms/sms-parser.interface";

import { normalizeSender, SupportedBank } from "./sender-normalizer";
import { classifyDirection, TransactionDirection } from "./direction-classifier";
import { categorizeMerchant, KnownCategory } from "./merchant-categorizer";
import { matchInternalTransfer } from "./transfer-matcher";
import { evaluateConfidence } from "./confidence-evaluator";
import { updateBalance } from "./balance-updater";
import { buildImportTransactionData } from "./transaction-builder";

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
  | { outcome: "auto_posted"; importedTransactionId: string; transactionId: string }
  | { outcome: "review_required"; importedTransactionId: string; parsedAmount: string; currency: string }
  | { outcome: "duplicate"; importedTransactionId: string }
  | { outcome: "ignored"; reason?: string }
  | { outcome: "pending_event"; importedTransactionId: string }
  | { outcome: "rejected"; reason: string }
  | { outcome: "disabled" }
  | { outcome: "idempotent"; importedTransactionId: string };

export class ImportService {
  async processSms(userId: string, payload: SmsWebhookPayload): Promise<ImportResult> {
    const { sender, message, receivedAt, deviceId, idempotencyKey } = payload;

    const importSetting = await db.importSetting.findUnique({ where: { userId } });
    if (!importSetting || !importSetting.enabled) {
      return { outcome: "disabled" };
    }

    if (idempotencyKey) {
      const existing = await db.importedTransaction.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { id: true },
      });
      if (existing) {
        return { outcome: "idempotent", importedTransactionId: existing.id };
      }
    }

    const bank = normalizeSender(sender);
    if (!bank) {
      return { outcome: "ignored", reason: "Sender not recognized" };
    }

    const selectionResult = smsParserRegistry.select(sender, message, importSetting.senderAllowlist);
    if (selectionResult.outcome === "no_match" || selectionResult.outcome === "ambiguous") {
      const redacted = redactFinancialText(message);
      const payloadHash = sha256(message);
      const maskedSenderValue = maskSender(sender);
      const reason = selectionResult.outcome === "ambiguous" ? "Ambiguous parsers matched" : selectionResult.reason;

      await db.auditLog.create({
        data: {
          userId,
          action: AuditAction.SMS_IMPORT_REJECTED,
          entityType: AuditEntityType.IMPORTED_TRANSACTION,
          entityId: "none",
          source: "SMS_WEBHOOK",
          metadata: { maskedSender: maskedSenderValue, payloadHash, redactedMessage: redacted, reason },
        },
      });
      return { outcome: "rejected", reason };
    }

    const parser = selectionResult.parser;
    let normalized: NormalizedSmsTransaction;
    try {
      normalized = parser.parse(sender, message, receivedAt);
    } catch (err) {
      return { outcome: "rejected", reason: err instanceof Error ? err.message : "Parsing execution failed" };
    }

    const maskedSenderValue = maskSender(sender);
    const fingerprint = buildFingerprint(normalized, maskedSenderValue);
    const existingByFingerprint = await db.importedTransaction.findUnique({
      where: { userId_fingerprint: { userId, fingerprint } },
      select: { id: true },
    });

    if (existingByFingerprint) {
      await db.importedTransaction.update({
        where: { id: existingByFingerprint.id },
        data: { duplicateCount: { increment: 1 }, lastDuplicateAt: new Date() },
      });
      return { outcome: "duplicate", importedTransactionId: existingByFingerprint.id };
    }

    const direction = classifyDirection(message, bank);
    if (direction === TransactionDirection.DECLINED || direction === TransactionDirection.INFORMATIONAL || direction === TransactionDirection.PENDING) {
      const status = direction === TransactionDirection.DECLINED ? ImportStatus.PROCESSED : ImportStatus.IGNORED;
      const outcome = direction === TransactionDirection.PENDING ? "pending_event" : "ignored";
      
      const importedTx = await db.importedTransaction.create({
        data: {
          source: ImportSource.SMS,
          institution: normalized.institution,
          status,
          parserKey: normalized.parserKey,
          parserVersion: normalized.parserVersion,
          redactedPayload: normalized.redactedMessage,
          rawPayload: message,
          deviceId: deviceId ?? null,
          payloadHash: normalized.payloadHash,
          maskedSender: maskedSenderValue,
          parsedAmount: new Prisma.Decimal(normalized.amount.toFixed(2)),
          parsedCurrency: normalized.currency,
          parsedReference: normalized.reference,
          fingerprint,
          receivedAt,
          financialDate: receivedAt,
          idempotencyKey: idempotencyKey ?? null,
          userId,
        },
      });
      
      // Update balance if available, even for ignored messages
      await this.syncBalance(userId, bank, normalized.availableBalance, direction, null, receivedAt);

      if (outcome === "pending_event") return { outcome: "pending_event", importedTransactionId: importedTx.id };
      return { outcome: "ignored" };
    }

    const category = categorizeMerchant(normalized.merchant);
    const confidenceScore = evaluateConfidence(
      normalized.amount.greaterThan(0),
      direction,
      category,
      !!normalized.reference,
      !!normalized.availableBalance
    );

    const confidence = confidenceScore >= 90 ? ImportConfidence.HIGH 
                     : confidenceScore >= 70 ? ImportConfidence.MEDIUM 
                     : ImportConfidence.LOW;

    const dubaiMs = normalized.transactionDate.getTime() + DUBAI_OFFSET_HOURS * 60 * 60 * 1000;
    const d = new Date(dubaiMs);
    const financialDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

    // Transfer matching
    let matchedTransferId: string | null = null;
    if (confidence !== ImportConfidence.LOW) {
        matchedTransferId = await matchInternalTransfer(
            userId,
            normalized.amount,
            financialDate,
            bank,
            direction === TransactionDirection.INFLOW,
            normalized.reference
        );
    }

    if (confidence === ImportConfidence.LOW) {
      const importedTx = await db.importedTransaction.create({
        data: {
          source: ImportSource.SMS,
          institution: normalized.institution,
          status: ImportStatus.REVIEW_REQUIRED,
          confidence,
          parserKey: normalized.parserKey,
          parserVersion: normalized.parserVersion,
          redactedPayload: normalized.redactedMessage,
          rawPayload: message,
          deviceId: deviceId ?? null,
          payloadHash: normalized.payloadHash,
          maskedSender: maskedSenderValue,
          parsedAmount: new Prisma.Decimal(normalized.amount.toFixed(2)),
          parsedCurrency: normalized.currency,
          parsedReference: normalized.reference,
          parsedDescription: normalized.merchant || "Unknown",
          fingerprint,
          receivedAt,
          financialDate,
          idempotencyKey: idempotencyKey ?? null,
          failureCode: "LOW_CONFIDENCE",
          userId,
        },
      });

      await this.syncBalance(userId, bank, normalized.availableBalance, direction, null, receivedAt);

      return { outcome: "review_required", importedTransactionId: importedTx.id, parsedAmount: normalized.amount.toFixed(2), currency: normalized.currency };
    }

    // Auto-Post
    try {
      const result = await db.$transaction(async (tx) => {
        await accountService.ensureDefaultAccounts(userId, tx);
        const accounts = await tx.account.findMany({ where: { userId } });
        const enbdAcc = accounts.find((a) => a.type === AccountType.EMIRATES_NBD)!;
        const mashreqAcc = accounts.find((a) => a.type === AccountType.MASHREQ)!;
        const cashAcc = accounts.find((a) => a.type === AccountType.CASH)!;
        const primaryAccId = bank === SupportedBank.MASHREQ ? mashreqAcc.id : enbdAcc.id;

        // Sync Balance first
        await updateBalance(primaryAccId, normalized.amount, direction, normalized.availableBalance, tx);

        let ledgerTxId: string;

        if (matchedTransferId) {
            ledgerTxId = matchedTransferId;
        } else {
            let txType: TransactionType = TransactionType.EXPENSE;
            let cashFlowDir: CashFlowDirection = CashFlowDirection.OUTFLOW;
            
            if (direction === TransactionDirection.INFLOW) {
                txType = TransactionType.INCOME;
                cashFlowDir = CashFlowDirection.INFLOW;
            }

            if (category === KnownCategory.TRANSFERS) {
                txType = TransactionType.TRANSFER;
            }

            // Map category string to actual category id
            const dbCategory = await tx.category.findFirst({
              where: { userId, name: { equals: category, mode: "insensitive" } }
            }) || await tx.category.findFirst({
              where: { userId, name: { equals: KnownCategory.UNCATEGORIZED, mode: "insensitive" } }
            });

            const ledgerTx = await tx.transaction.create({
                data: {
                    date: financialDate,
                    categoryId: dbCategory!.id,
                    description: normalized.merchant || "Auto-imported",
                    amount: normalized.amount,
                    paymentMethod: "SMS Import",
                    type: txType,
                    cashFlowDirection: cashFlowDir,
                    origin: TransactionOrigin.SMS_IMPORT,
                    accountId: primaryAccId,
                    userId,
                }
            });
            ledgerTxId = ledgerTx.id;
        }

        const importedTx = await tx.importedTransaction.create({
            data: {
              source: ImportSource.SMS,
              institution: normalized.institution,
              status: ImportStatus.PROCESSED,
              confidence,
              parserKey: normalized.parserKey,
              parserVersion: normalized.parserVersion,
              redactedPayload: normalized.redactedMessage,
              rawPayload: message,
              deviceId: deviceId ?? null,
              payloadHash: normalized.payloadHash,
              maskedSender: maskedSenderValue,
              parsedAmount: new Prisma.Decimal(normalized.amount.toFixed(2)),
              parsedCurrency: normalized.currency,
              parsedReference: normalized.reference,
              parsedDescription: normalized.merchant || "Auto-imported",
              fingerprint,
              receivedAt,
              financialDate,
              idempotencyKey: idempotencyKey ?? null,
              userId,
              transactionId: ledgerTxId,
              processedAt: new Date()
            },
        });

        await tx.importSetting.update({
          where: { userId },
          data: { lastSuccessfulImportAt: new Date() },
        });

        return { importedTxId: importedTx.id, ledgerTxId };
      });

      return { outcome: "auto_posted", importedTransactionId: result.importedTxId, transactionId: result.ledgerTxId };
    } catch (err) {
      throw err;
    }
  }

  async confirmImport(
    userId: string,
    importedTransactionId: string,
    overrides?: { categoryId?: string; financialDate?: Date }
  ): Promise<{ transactionId: string }> {
    return await db.$transaction(async (tx) => {
      const importedTx = await tx.importedTransaction.findUnique({
        where: { id: importedTransactionId },
      });

      if (!importedTx || importedTx.userId !== userId) {
        throw new Error("IMPORT_NOT_FOUND");
      }

      if (importedTx.status !== ImportStatus.REVIEW_REQUIRED) {
        throw new Error("Import is not in REVIEW_REQUIRED state");
      }

      await accountService.ensureDefaultAccounts(userId, tx);
      const accounts = await tx.account.findMany({ where: { userId } });
      const bank = normalizeSender(importedTx.maskedSender);
      
      const enbdAcc = accounts.find((a) => a.type === AccountType.EMIRATES_NBD)!;
      const mashreqAcc = accounts.find((a) => a.type === AccountType.MASHREQ)!;
      const primaryAccId = bank === SupportedBank.MASHREQ ? mashreqAcc.id : enbdAcc.id;

      // Note: syncBalance was already called when the SMS was received (in processSms), 
      // so we don't need to call updateBalance here again. The available balance was already synced.
      // Wait, if it wasn't an available balance sync, we might need to update the balance?
      // In the new architecture, syncBalance handles both the availableBalance override AND the relative amount deduction.
      // Wait, let's check processSms logic.
      // In processSms: `await this.syncBalance(..., direction, null, receivedAt);` for LOW_CONFIDENCE.
      // Actually, wait! In processSms:
      // `await this.syncBalance(userId, bank, normalized.availableBalance, direction, null, receivedAt);`
      // Notice `amount` passed to `syncBalance` is `null`!
      // This means relative balance update was NOT applied for LOW_CONFIDENCE imports.
      // Therefore, we MUST update the relative balance here upon confirmation!

      const direction = classifyDirection(importedTx.rawPayload, bank!);
      await updateBalance(primaryAccId, importedTx.parsedAmount, direction, null);

      let txType: TransactionType = TransactionType.EXPENSE;
      let cashFlowDir: CashFlowDirection = CashFlowDirection.OUTFLOW;
      
      if (direction === TransactionDirection.INFLOW) {
          txType = TransactionType.INCOME;
          cashFlowDir = CashFlowDirection.INFLOW;
      }

      let categoryId = overrides?.categoryId;
      let categoryStr: string = "";
      if (!categoryId) {
        categoryStr = categorizeMerchant(importedTx.parsedDescription || "");
        const dbCategory = await tx.category.findFirst({
          where: { userId, name: { equals: categoryStr, mode: "insensitive" } }
        }) || await tx.category.findFirst({
          where: { userId, name: { equals: KnownCategory.UNCATEGORIZED, mode: "insensitive" } }
        });
        categoryId = dbCategory!.id;
      }

      if (categoryStr === KnownCategory.TRANSFERS) {
          txType = TransactionType.TRANSFER;
      }

      const ledgerTx = await tx.transaction.create({
          data: {
              date: overrides?.financialDate || importedTx.financialDate,
              categoryId,
              description: importedTx.parsedDescription || "Manually confirmed",
              amount: importedTx.parsedAmount,
              paymentMethod: "SMS Import",
              type: txType,
              cashFlowDirection: cashFlowDir,
              origin: TransactionOrigin.SMS_IMPORT,
              accountId: primaryAccId,
              userId,
          }
      });

      await tx.importedTransaction.update({
          where: { id: importedTx.id },
          data: {
            status: ImportStatus.PROCESSED,
            transactionId: ledgerTx.id,
            processedAt: new Date(),
          },
      });

      // Process debt payment logic if category is DEBT
      const category = await tx.category.findUnique({ where: { id: categoryId } });
      if (category && category.type === "DEBT") {
        const debt = await tx.debt.findFirst({
          where: { userId, categoryId },
        });
        if (debt) {
          const newBalance = new Prisma.Decimal(debt.currentBalance).minus(importedTx.parsedAmount);
          const status = newBalance.lte(0) ? "PAID" : debt.status;
          await tx.debt.update({
            where: { id: debt.id },
            data: { currentBalance: newBalance, status },
          });

          if (status === "PAID" && debt.status !== "PAID") {
            await notificationService.createNotification(tx, {
              userId,
              type: NotificationType.DEBT_PAID_OFF,
              severity: NotificationSeverity.SUCCESS,
              title: "Debt Paid Off!",
              message: `You have successfully paid off your debt: ${debt.name}.`,
              metadata: { debtId: debt.id },
            });
          }
        }
      }

      return { transactionId: ledgerTx.id };
    });
  }

  async rejectImport(userId: string, importedTransactionId: string): Promise<void> {
    const importedTx = await db.importedTransaction.findUnique({ where: { id: importedTransactionId } });
    if (!importedTx || importedTx.userId !== userId) throw new Error("IMPORT_NOT_FOUND");
    await db.importedTransaction.update({
      where: { id: importedTx.id },
      data: { status: ImportStatus.REJECTED, reviewedAt: new Date() },
    });
  }

  private async syncBalance(
    userId: string, 
    bank: SupportedBank, 
    authoritativeBalance: Decimal | null, 
    direction: TransactionDirection, 
    amount: Decimal | null,
    receivedAt: Date
  ) {
    await accountService.ensureDefaultAccounts(userId);
    const accounts = await db.account.findMany({ where: { userId } });
    const enbdAcc = accounts.find((a) => a.type === AccountType.EMIRATES_NBD);
    const mashreqAcc = accounts.find((a) => a.type === AccountType.MASHREQ);
    const primaryAccId = bank === SupportedBank.MASHREQ ? mashreqAcc?.id : enbdAcc?.id;

    if (!primaryAccId) return;

    await updateBalance(primaryAccId, amount, direction, authoritativeBalance);
  }
}

export const importService = new ImportService();
