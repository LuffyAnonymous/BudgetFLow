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
  CategoryType,
  ImportConfidence,
  NotificationType,
  NotificationSeverity,
} from "@prisma/client";
import { Decimal } from "decimal.js";
import { sha256, maskSender, redactFinancialText } from "./redaction";
import { smsParserRegistry } from "../sms/parser-registry";
import { buildFingerprint } from "./duplicate-detector";
import { accountService } from "../../server/services/account.service";
import { determineBudgetMonth } from "@/lib/salary-month";
import type { NormalizedSmsTransaction } from "../sms/sms-parser.interface";

import { resolveInstitution, ResolvedInstitution } from "./sender-normalizer";
import { isCreditCardTransaction } from "./card-type-classifier";
import { classifyDirection, isDirectionAmbiguous, TransactionDirection } from "./direction-classifier";
import { categorizeMerchant, KnownCategory } from "./merchant-categorizer";
import { resolveFallbackCategory, resolveCategoryByAlias } from "./category-resolver";
import { matchInternalTransfer } from "./transfer-matcher";
import { evaluateConfidence } from "./confidence-evaluator";
import { updateBalance } from "./balance-updater";
import { extractSmsTransaction, AI_SMS_PARSER_KEY } from "./ai-sms-extractor";
import { isOtpOrPromoMessage } from "../sms/otp-promo-filter";

const DUBAI_OFFSET_HOURS = 4;

export interface SmsWebhookPayload {
  sender: string;
  message: string;
  receivedAt: Date;
  deviceId?: string | null;
  idempotencyKey?: string | null;
}

export type ImportResult =
  | {
      outcome: "auto_posted";
      importedTransactionId: string;
      transactionId: string;
      confidence: ImportConfidence;
      directionAmbiguous: boolean;
    }
  | { outcome: "duplicate"; importedTransactionId: string }
  | { outcome: "ignored"; reason?: string }
  | { outcome: "pending_event"; importedTransactionId: string }
  | { outcome: "failed"; importedTransactionId: string; reason: string }
  | { outcome: "disabled" }
  | { outcome: "idempotent"; importedTransactionId: string };

export class ImportService {
  async processSms(userId: string, payload: SmsWebhookPayload): Promise<ImportResult> {
    const { sender, message, receivedAt, deviceId, idempotencyKey } = payload;
    const payloadHash = sha256(message);
    const hashPrefix = payloadHash.slice(0, 10);
    const messageLength = message.length;

    console.log("[Import Service] Starting SMS processing", {
      sender,
      messageLength,
      hashPrefix,
      hasIdempotencyKey: !!idempotencyKey,
    });

    try {
      const importSetting = await db.importSetting.findUnique({ where: { userId } });
      if (!importSetting || !importSetting.enabled) {
        console.log("[Import Service] Import disabled for user", { userId });
        return { outcome: "disabled" };
      }

      if (idempotencyKey) {
        const existing = await db.importedTransaction.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
          select: { id: true },
        });
        if (existing) {
          console.log("[Import Service] Idempotent request detected", { idempotencyKey });
          return { outcome: "idempotent", importedTransactionId: existing.id };
        }
      }

      // Every sender resolves to *some* institution now — unrecognized ones
      // fall back to OTHER_BANK with a derived display name, never null.
      const institution = resolveInstitution(sender);
      const maskedSenderValue = maskSender(sender);

      // A credit card purchase increases what's owed, not spendable cash —
      // track it on its own account (suffixed so it never collides with the
      // same bank's checking account) rather than debiting real money.
      const isCreditCard = isCreditCardTransaction(message);
      const institutionForAccount: ResolvedInstitution = isCreditCard
        ? { ...institution, displayName: `${institution.displayName} Credit Card` }
        : institution;

      console.log("[Import Service] Stage: Selecting parser", { institution: institutionForAccount.displayName, isCreditCard });
      const selectionResult = smsParserRegistry.select(sender, message, importSetting.senderAllowlist);

      let normalized: NormalizedSmsTransaction;
      let extractionMethod: "REGEX" | "AI_TEXT";

      if (selectionResult.outcome === "matched") {
        const parser = selectionResult.parser;
        console.log("[Import Service] Stage: Parsing message", { parserKey: parser.parserKey });
        try {
          normalized = parser.parse(sender, message, receivedAt);
          extractionMethod = "REGEX";
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Parsing execution failed";
          console.log("[Import Service] Parser parse threw exception", { parserKey: parser.parserKey, errMsg });
          return await this.recordFailure(userId, {
            institution: institutionForAccount.displayName,
            message,
            deviceId,
            payloadHash,
            maskedSenderValue,
            receivedAt,
            idempotencyKey,
            failureCode: "PARSE_ERROR",
            failureMessage: errMsg,
          });
        }
      } else if (selectionResult.outcome === "ambiguous") {
        // Two regex parsers both claimed this message — a real conflict to
        // fix in code, not something to hand to the AI fallback.
        const reason = `Ambiguous parsers matched: ${selectionResult.matchedParsers.join(", ")}`;
        console.log("[Import Service] Parser selection failed", { outcome: selectionResult.outcome, reason });
        return await this.recordFailure(userId, {
          institution: institutionForAccount.displayName,
          message,
          deviceId,
          payloadHash,
          maskedSenderValue,
          receivedAt,
          idempotencyKey,
          failureCode: "AMBIGUOUS_PARSER_MATCH",
          failureMessage: reason,
        });
      } else if (selectionResult.reason === "Sender not in configured allowlist") {
        // An untrusted sender never gets an AI-parse attempt — the allowlist
        // is the trust boundary, and skipping straight to FAILED here (rather
        // than falling into the AI fallback below) keeps that boundary real.
        console.log("[Import Service] Sender not in allowlist, skipping AI fallback", { maskedSender: maskedSenderValue });
        return await this.recordFailure(userId, {
          institution: institutionForAccount.displayName,
          message,
          deviceId,
          payloadHash,
          maskedSenderValue,
          receivedAt,
          idempotencyKey,
          failureCode: "SENDER_NOT_ALLOWLISTED",
          failureMessage: "Sender is not in the configured allowlist.",
        });
      } else if (isOtpOrPromoMessage(message)) {
        // Every registered parser's canParse() already rejects OTP/promo
        // content, so a trusted sender's OTP/promo text reliably lands here
        // as "no_match". Catching it before the AI fallback means it never
        // triggers a wasted Anthropic call — it's expected non-transaction
        // noise, not a parse failure worth recording.
        console.log("[Import Service] OTP/promo message detected, skipping AI fallback", { maskedSender: maskedSenderValue });
        return { outcome: "ignored", reason: "OTP or promotional message — not a transaction" };
      } else {
        // no_match: the sender is trusted (it's in the user's own allowlist
        // — parser-registry.ts checked that already), but no regex parser
        // recognized the message shape. Try the AI safety net before giving
        // up, and never disappear a trusted-sender message with zero trace.
        console.log("[Import Service] Stage: No regex parser matched, trying AI fallback");
        const aiResult = await extractSmsTransaction(message);

        if (aiResult) {
          normalized = {
            source: "SMS",
            institution: institutionForAccount.displayName,
            parserKey: AI_SMS_PARSER_KEY,
            parserVersion: "1.0.0",
            amount: aiResult.amount,
            currency: aiResult.currency,
            merchant: aiResult.merchant,
            reference: aiResult.referenceCode,
            transactionDate: receivedAt,
            redactedMessage: redactFinancialText(message),
            payloadHash,
            availableBalance: aiResult.availableBalance,
            accountEnding: null,
            isDeclined: false,
            metadata: { maskedSender: maskedSenderValue, extractionMethod: "AI_TEXT" },
          };
          extractionMethod = "AI_TEXT";
        } else {
          console.log("[Import Service] AI fallback also failed to extract a transaction");
          return await this.recordFailure(userId, {
            institution: institutionForAccount.displayName,
            message,
            deviceId,
            payloadHash,
            maskedSenderValue,
            receivedAt,
            idempotencyKey,
            failureCode: "EXTRACTION_FAILED",
            failureMessage: "Could not automatically extract transaction details from this message.",
          });
        }
      }

      // A regex parser can correctly extract amount/balance/reference while
      // still failing on the merchant name alone — bank SMS formatting is
      // too varied to regex-proof completely (e.g. unexpected punctuation).
      // Rather than patching one more edge case into the regex every time
      // this happens, ask the AI to recover just the merchant field so a
      // parser's blind spot never has to become a manual-review case.
      if (extractionMethod === "REGEX" && !normalized.merchant) {
        console.log("[Import Service] Stage: Merchant missing after regex parse, attempting AI merchant recovery");
        const aiRecovery = await extractSmsTransaction(message);
        if (aiRecovery?.merchant) {
          console.log("[Import Service] AI merchant recovery succeeded", { merchant: aiRecovery.merchant });
          normalized = { ...normalized, merchant: aiRecovery.merchant };
        } else {
          console.log("[Import Service] AI merchant recovery found no merchant either");
        }
      }

      if (isCreditCard) {
        // A credit card's reported figure ("Available Credit Limit",
        // "Outstanding Balance") isn't cash on hand the way a checking
        // account's "Available Balance" is, and can even carry the opposite
        // sign meaning — never trust it as the account's authoritative
        // balance. The account's tracked balance is instead computed purely
        // from the transaction ledger (updateBalance's amount+direction
        // math), the same way a BNPL account's balance already is.
        normalized = { ...normalized, institution: institutionForAccount.displayName, availableBalance: null };
      }

      const fingerprint = buildFingerprint(normalized, maskedSenderValue);
      const existingByFingerprint = await db.importedTransaction.findUnique({
        where: { userId_fingerprint: { userId, fingerprint } },
        select: { id: true },
      });

      if (existingByFingerprint) {
        console.log("[Import Service] Duplicate transaction detected by fingerprint", { fingerprintPrefix: fingerprint.slice(0, 10) });
        await db.importedTransaction.update({
          where: { id: existingByFingerprint.id },
          data: { duplicateCount: { increment: 1 }, lastDuplicateAt: new Date() },
        });
        return { outcome: "duplicate", importedTransactionId: existingByFingerprint.id };
      }

      console.log("[Import Service] Stage: Classifying direction");
      const direction = classifyDirection(message);
      const directionAmbiguous = isDirectionAmbiguous(message);
      if (direction === TransactionDirection.DECLINED || direction === TransactionDirection.INFORMATIONAL || direction === TransactionDirection.PENDING) {
        const status = direction === TransactionDirection.DECLINED ? ImportStatus.PROCESSED : ImportStatus.REJECTED;
        const outcome = direction === TransactionDirection.PENDING ? "pending_event" : "ignored";
        const failureCode = direction === TransactionDirection.PENDING ? "PENDING_TRANSACTION" : "INFORMATIONAL_MESSAGE";
        const failureMessage = direction === TransactionDirection.PENDING ? "Pending transactions are not posted." : "Informational messages are ignored.";

        console.log("[Import Service] Ignored or pending message processed", { direction, status });
        const importedTx = await db.importedTransaction.create({
          data: {
            source: ImportSource.SMS,
            institution: normalized.institution,
            status,
            parserKey: normalized.parserKey,
            parserVersion: normalized.parserVersion,
            extractionMethod,
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
            failureCode: status === ImportStatus.REJECTED ? failureCode : null,
            failureMessage: status === ImportStatus.REJECTED ? failureMessage : null,
          },
        });

        await this.syncBalance(userId, institutionForAccount, normalized.availableBalance, direction, null, isCreditCard);

        if (outcome === "pending_event") return { outcome: "pending_event", importedTransactionId: importedTx.id };
        return { outcome: "ignored" };
      }

      console.log("[Import Service] Stage: Categorizing merchant");
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

      // LOW confidence still auto-posts (below) — it just skips internal-
      // transfer matching. Merging two transactions together on a
      // low-confidence guess would compound the risk rather than contain it.
      console.log("[Import Service] Stage: Match internal transfer", { confidence });
      let matchedTransferId: string | null = null;
      if (confidence !== ImportConfidence.LOW) {
          matchedTransferId = await matchInternalTransfer(
              userId,
              normalized.amount,
              financialDate,
              direction === TransactionDirection.INFLOW
          );
      }

      console.log("[Import Service] Stage: Executing auto-post transaction");
      const result = await db.$transaction(async (tx) => {
        const account = await accountService.ensureAccountForInstitution(
          userId,
          { type: institutionForAccount.accountType, name: institutionForAccount.displayName, isCreditCard },
          tx
        );
        const primaryAccId = account.id;

        await updateBalance(primaryAccId, normalized.amount, direction, normalized.availableBalance, tx);

        let ledgerTxId: string;

        const isSalary = category.toLowerCase() === "salary" || (normalized.parserKey ?? "").toLowerCase().includes("salary");
        const { getActiveFinancialCycle } = await import("@/lib/salary-month");

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

            let dbCategory: { id: string } | null = await tx.category.findFirst({
              where: { userId, name: { equals: category, mode: "insensitive" } }
            });

            // The generic label ("Buy Now Pay Later") may not match a user's
            // own category name verbatim (e.g. "Tabby Payment") — try known
            // aliases before falling through further.
            if (!dbCategory) {
              dbCategory = await resolveCategoryByAlias(tx, userId, category);
            }

            // Merchant-keyword matching came up empty — try the salary-ratio /
            // single-type-match rules before falling back to "Uncategorized".
            if (!dbCategory && category === KnownCategory.UNCATEGORIZED) {
              dbCategory = await resolveFallbackCategory(tx, userId, txType, normalized.amount);
            }

            dbCategory = dbCategory || await tx.category.findFirst({
              where: { userId, name: { equals: KnownCategory.UNCATEGORIZED, mode: "insensitive" } }
            });

            if (!dbCategory) {
              dbCategory = await tx.category.create({
                data: {
                  userId,
                  name: KnownCategory.UNCATEGORIZED,
                  type: direction === TransactionDirection.INFLOW ? CategoryType.INCOME : CategoryType.VARIABLE_EXPENSE,
                },
              });
            }

            const computedBudgetMonth = isSalary
              ? determineBudgetMonth(financialDate, true)
              : await getActiveFinancialCycle(userId, financialDate, tx);

            const ledgerTx = await tx.transaction.create({
                data: {
                    date: financialDate,
                    budgetMonth: computedBudgetMonth,
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

            // Process debt payment logic if category is DEBT — ported from
            // confirmImport() so auto-posted transactions decrement debt
            // balances too, not just manually confirmed ones.
            const postedCategory = await tx.category.findUnique({ where: { id: dbCategory!.id } });
            if (postedCategory && postedCategory.type === CategoryType.DEBT) {
              const debt = await tx.debt.findFirst({
                where: { userId, categoryId: postedCategory.id },
              });
              if (debt) {
                const newBalance = new Prisma.Decimal(debt.currentBalance).minus(normalized.amount);
                const debtStatus = newBalance.lte(0) ? "PAID" : debt.status;
                await tx.debt.update({
                  where: { id: debt.id },
                  data: { currentBalance: newBalance, status: debtStatus },
                });

                if (debtStatus === "PAID" && debt.status !== "PAID") {
                  await tx.notification.create({
                    data: {
                      userId,
                      type: NotificationType.DEBT_PAID_OFF,
                      severity: NotificationSeverity.INFO,
                      title: "Debt Paid Off!",
                      message: `You have successfully paid off your debt: ${debt.name}.`,
                      eventKey: `debt-paid-${debt.id}-${ledgerTx.id}`,
                    },
                  });
                }
              }
            }
        }

        const computedBudgetMonth = isSalary
          ? determineBudgetMonth(financialDate, true)
          : await getActiveFinancialCycle(userId, financialDate, tx);

        const importedTx = await tx.importedTransaction.create({
            data: {
              source: ImportSource.SMS,
              institution: normalized.institution,
              status: ImportStatus.PROCESSED,
              confidence,
              directionAmbiguous,
              parserKey: normalized.parserKey,
              parserVersion: normalized.parserVersion,
              extractionMethod,
              redactedPayload: normalized.redactedMessage,
              rawPayload: message,
              deviceId: deviceId ?? null,
              payloadHash: normalized.payloadHash,
              maskedSender: maskedSenderValue,
              parsedAmount: new Prisma.Decimal(normalized.amount.toFixed(2)),
              parsedCurrency: normalized.currency,
              parsedReference: normalized.reference,
              parsedDescription: normalized.merchant || "Auto-imported",
              budgetMonth: computedBudgetMonth,
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

      console.log("[Import Service] SMS auto-posted successfully", { importedTxId: result.importedTxId, confidence, directionAmbiguous });
      return {
        outcome: "auto_posted",
        importedTransactionId: result.importedTxId,
        transactionId: result.ledgerTxId,
        confidence,
        directionAmbiguous,
      };
    } catch (err) {
      const errorObj = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
      console.error("[Import Service] Exception during processSms:", errorObj);
      throw err;
    }
  }

  /**
   * A hard parse failure — the message contained nothing postable, as
   * opposed to a parseable-but-uncertain low-confidence guess. Always
   * creates a FAILED ImportedTransaction row (never disappears the message
   * with zero trace) so it stays visible and correctable.
   */
  private async recordFailure(
    userId: string,
    params: {
      institution: string;
      message: string;
      deviceId?: string | null;
      payloadHash: string;
      maskedSenderValue: string;
      receivedAt: Date;
      idempotencyKey?: string | null;
      failureCode: string;
      failureMessage: string;
    }
  ): Promise<ImportResult> {
    const {
      institution,
      message,
      deviceId,
      payloadHash,
      maskedSenderValue,
      receivedAt,
      idempotencyKey,
      failureCode,
      failureMessage,
    } = params;
    const redacted = redactFinancialText(message);

    try {
      const importedTx = await db.importedTransaction.create({
        data: {
          source: ImportSource.SMS,
          institution,
          status: ImportStatus.FAILED,
          parserKey: null,
          redactedPayload: redacted,
          rawPayload: message,
          deviceId: deviceId ?? null,
          payloadHash,
          maskedSender: maskedSenderValue,
          fingerprint: payloadHash,
          receivedAt,
          financialDate: receivedAt,
          idempotencyKey: idempotencyKey ?? null,
          failureCode,
          failureMessage,
          userId,
        },
      });

      await db.auditLog.create({
        data: {
          userId,
          action: AuditAction.SMS_IMPORT_FAILED,
          entityType: AuditEntityType.IMPORTED_TRANSACTION,
          entityId: importedTx.id,
          source: "SMS_WEBHOOK",
          metadata: { maskedSender: maskedSenderValue, payloadHash, redactedMessage: redacted, failureCode, failureMessage },
        },
      });

      return { outcome: "failed", importedTransactionId: importedTx.id, reason: failureMessage };
    } catch (err) {
      // The exact same failing message was already recorded (fingerprint
      // collision on payloadHash — e.g. a Shortcut retry with no
      // Idempotency-Key header). Surface the existing row instead of a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await db.importedTransaction.findUnique({
          where: { userId_fingerprint: { userId, fingerprint: payloadHash } },
          select: { id: true },
        });
        if (existing) {
          await db.importedTransaction.update({
            where: { id: existing.id },
            data: { duplicateCount: { increment: 1 }, lastDuplicateAt: new Date() },
          });
          return { outcome: "failed", importedTransactionId: existing.id, reason: failureMessage };
        }
      }
      throw err;
    }
  }

  async confirmImport(
    userId: string,
    importedTransactionId: string,
    overrides?: { categoryId?: string; financialDate?: Date; amount?: Decimal; description?: string }
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

      const amount = overrides?.amount
        ? new Prisma.Decimal(overrides.amount.toFixed(2))
        : importedTx.parsedAmount;
      if (!amount) {
        throw new Error("Cannot confirm import: parsedAmount is missing — provide an amount override");
      }

      const isDocument = importedTx.source === ImportSource.DOCUMENT;

      // A receipt/invoice is always a completed expense with no bank account
      // to cross-check a balance against (accountId stays null — that field
      // is nullable precisely for cases like this). Bank/BNPL SMS imports
      // keep resolving and updating their institution's account as before.
      let primaryAccId: string | null = null;
      let direction: TransactionDirection = TransactionDirection.OUTFLOW;

      if (isDocument) {
        direction = TransactionDirection.OUTFLOW;
      } else {
        // The institution's account was already created (by syncBalance)
        // when the import was first received, keyed by its display name.
        // Fall back to creating it here as a safety net for any
        // pre-existing row that somehow predates that.
        const primaryAccount = await accountService.ensureAccountForInstitution(
          userId,
          { type: AccountType.OTHER_BANK, name: importedTx.institution },
          tx
        );
        primaryAccId = primaryAccount.id;
        direction = classifyDirection(importedTx.rawPayload || "");
        await updateBalance(primaryAccId, amount, direction, null);
      }

      let txType: TransactionType = TransactionType.EXPENSE;
      let cashFlowDir: CashFlowDirection = CashFlowDirection.OUTFLOW;

      if (direction === TransactionDirection.INFLOW) {
          txType = TransactionType.INCOME;
          cashFlowDir = CashFlowDirection.INFLOW;
      }

      const description = overrides?.description || importedTx.parsedDescription || "Manually confirmed";

      let categoryId = overrides?.categoryId;
      let categoryStr: string = "";
      if (!categoryId) {
        categoryStr = categorizeMerchant(description);
        let dbCategory: { id: string } | null = await tx.category.findFirst({
          where: { userId, name: { equals: categoryStr, mode: "insensitive" } }
        });

        if (!dbCategory) {
          dbCategory = await resolveCategoryByAlias(tx, userId, categoryStr);
        }

        if (!dbCategory && categoryStr === KnownCategory.UNCATEGORIZED) {
          dbCategory = await resolveFallbackCategory(tx, userId, txType, amount);
        }

        dbCategory = dbCategory || await tx.category.findFirst({
          where: { userId, name: { equals: KnownCategory.UNCATEGORIZED, mode: "insensitive" } }
        });
        categoryId = dbCategory!.id;
      }

      if (categoryStr === KnownCategory.TRANSFERS) {
          txType = TransactionType.TRANSFER;
      }

      const effectiveDate = overrides?.financialDate || importedTx.financialDate || importedTx.receivedAt;
      const isSalary = categoryStr.toLowerCase() === "salary" || (importedTx.parserKey ?? "").toLowerCase().includes("salary");
      const { getActiveFinancialCycle } = await import("@/lib/salary-month");
      const computedBudgetMonth = importedTx.budgetMonth || (
        isSalary
          ? determineBudgetMonth(effectiveDate, true)
          : await getActiveFinancialCycle(userId, effectiveDate, tx)
      );

      const ledgerTx = await tx.transaction.create({
          data: {
              date: effectiveDate,
              budgetMonth: computedBudgetMonth,
              categoryId,
              description,
              amount,
              paymentMethod: isDocument ? "Receipt Upload" : "SMS Import",
              type: txType,
              cashFlowDirection: cashFlowDir,
              origin: isDocument ? TransactionOrigin.MANUAL : TransactionOrigin.SMS_IMPORT,
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

      // A DOCUMENT-sourced import (receipt/invoice upload) has its uploaded
      // file attached to the ImportedTransaction row — re-point it onto the
      // newly created Transaction so it shows up as a normal attachment.
      if (importedTx.source === ImportSource.DOCUMENT) {
        await tx.attachment.updateMany({
          where: { importedTransactionId: importedTx.id },
          data: { importedTransactionId: null, transactionId: ledgerTx.id },
        });
      }

      // Process debt payment logic if category is DEBT
      const category = await tx.category.findUnique({ where: { id: categoryId } });
      if (category && category.type === "DEBT") {
        const debt = await tx.debt.findFirst({
          where: { userId, categoryId },
        });
        if (debt) {
          const newBalance = new Prisma.Decimal(debt.currentBalance).minus(amount);
          const status = newBalance.lte(0) ? "PAID" : debt.status;
          await tx.debt.update({
            where: { id: debt.id },
            data: { currentBalance: newBalance, status },
          });

          if (status === "PAID" && debt.status !== "PAID") {
            await tx.notification.create({
              data: {
                  userId,
                  type: NotificationType.DEBT_PAID_OFF,
                  severity: NotificationSeverity.INFO, // Assuming SUCCESS is not valid, INFO is used earlier
                  title: "Debt Paid Off!",
                  message: `You have successfully paid off your debt: ${debt.name}.`,
                  eventKey: `debt-paid-${debt.id}-${ledgerTx.id}`,
              }
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
    institution: ResolvedInstitution,
    authoritativeBalance: Decimal | null,
    direction: TransactionDirection,
    amount: Decimal | null,
    isCreditCard: boolean = false
  ) {
    const account = await accountService.ensureAccountForInstitution(userId, {
      type: institution.accountType,
      name: institution.displayName,
      isCreditCard,
    });

    await updateBalance(account.id, amount, direction, authoritativeBalance);
  }
}

export const importService = new ImportService();
