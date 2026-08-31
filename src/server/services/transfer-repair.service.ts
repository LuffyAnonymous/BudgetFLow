import "server-only";

import { db } from "@/lib/db";
import { AuditAction, AuditEntityType, Prisma, TransactionType } from "@prisma/client";
import { accountService } from "./account.service";
import { AuditLogService } from "./audit-log.service";

export type TransferRepairStatus = "FIXABLE" | "WRONG_LEG_COUNT" | "ACCOUNT_NOT_FOUND" | "AMBIGUOUS";

export interface TransferRepairLeg {
  institution: string;
  amount: string | null;
  description: string | null;
  receivedAt: Date;
}

export interface TransferRepairCandidate {
  transactionId: string;
  date: Date;
  amount: string;
  description: string;
  currentAccountName: string | null;
  currentToAccountName: string | null;
  legs: TransferRepairLeg[];
  status: TransferRepairStatus;
  detail: string;
  resolvedAccountId: string | null;
  resolvedToAccountId: string | null;
  resolvedAccountName: string | null;
  resolvedToAccountName: string | null;
}

/**
 * Diagnoses and repairs Transaction rows of type TRANSFER that are missing
 * accountId or toAccountId — the historical fallout of a bug where matching
 * two SMS/email legs into one internal transfer never recorded which
 * account the money arrived in (fixed going forward in import.service.ts,
 * but rows created before that fix still need a one-time repair).
 *
 * Every method is scoped to a single userId — there is no cross-user
 * capability here, deliberately: each user can only diagnose/repair their
 * own ledger.
 */
export class TransferRepairService {
  async diagnose(userId: string): Promise<TransferRepairCandidate[]> {
    const candidates = await db.transaction.findMany({
      where: {
        userId,
        type: TransactionType.TRANSFER,
        OR: [{ accountId: null }, { toAccountId: null }],
      },
      include: {
        account: true,
        toAccount: true,
        importedTransactions: true,
      },
      orderBy: { date: "desc" },
    });

    const results: TransferRepairCandidate[] = [];

    for (const tx of candidates) {
      const legs = tx.importedTransactions;
      const base = {
        transactionId: tx.id,
        date: tx.date,
        amount: tx.amount.toFixed(2),
        description: tx.description,
        currentAccountName: tx.account?.name ?? null,
        currentToAccountName: tx.toAccount?.name ?? null,
        legs: legs.map((l) => ({
          institution: l.institution ?? "(unknown)",
          amount: l.parsedAmount ? l.parsedAmount.toFixed(2) : null,
          description: l.parsedDescription,
          receivedAt: l.receivedAt,
        })),
      };

      if (legs.length !== 2) {
        results.push({
          ...base,
          status: "WRONG_LEG_COUNT",
          detail: `Expected exactly 2 linked SMS/email legs, found ${legs.length} — needs manual review.`,
          resolvedAccountId: null,
          resolvedToAccountId: null,
          resolvedAccountName: null,
          resolvedToAccountName: null,
        });
        continue;
      }

      // ImportedTransaction.institution is written as the exact display
      // name Account.name was created with (see ensureAccountForInstitution)
      // — a plain (userId, name) lookup, not a re-resolution through
      // resolveInstitution(), which is built for raw sender strings and
      // would mis-map some already-resolved display names.
      const legAccounts = await Promise.all(
        legs.map((l) =>
          db.account.findUnique({ where: { userId_name: { userId, name: l.institution ?? "" } } })
        )
      );

      if (legAccounts.some((a) => !a)) {
        results.push({
          ...base,
          status: "ACCOUNT_NOT_FOUND",
          detail: "One of the two legs' institutions doesn't match an existing account — needs manual review.",
          resolvedAccountId: null,
          resolvedToAccountId: null,
          resolvedAccountName: null,
          resolvedToAccountName: null,
        });
        continue;
      }

      const [legAccountA, legAccountB] = legAccounts as NonNullable<(typeof legAccounts)[number]>[];
      const legAccountIds = [legAccountA.id, legAccountB.id];

      const knownAccountId = tx.accountId;
      const knownToAccountId = tx.toAccountId;

      if (knownAccountId && !legAccountIds.includes(knownAccountId)) {
        results.push({
          ...base,
          status: "AMBIGUOUS",
          detail: "Neither leg's institution matches the account already set on this transfer — needs manual review.",
          resolvedAccountId: null,
          resolvedToAccountId: null,
          resolvedAccountName: null,
          resolvedToAccountName: null,
        });
        continue;
      }
      if (knownToAccountId && !legAccountIds.includes(knownToAccountId)) {
        results.push({
          ...base,
          status: "AMBIGUOUS",
          detail: "Neither leg's institution matches the destination account already set on this transfer — needs manual review.",
          resolvedAccountId: null,
          resolvedToAccountId: null,
          resolvedAccountName: null,
          resolvedToAccountName: null,
        });
        continue;
      }

      const resolvedAccountId = knownAccountId ?? legAccountIds.find((id) => id !== knownToAccountId) ?? null;
      const resolvedToAccountId = knownToAccountId ?? legAccountIds.find((id) => id !== knownAccountId) ?? null;

      if (!resolvedAccountId || !resolvedToAccountId || resolvedAccountId === resolvedToAccountId) {
        results.push({
          ...base,
          status: "AMBIGUOUS",
          detail: "Could not unambiguously determine both sides of the transfer — needs manual review.",
          resolvedAccountId: null,
          resolvedToAccountId: null,
          resolvedAccountName: null,
          resolvedToAccountName: null,
        });
        continue;
      }

      const accountsById = new Map([
        [legAccountA.id, legAccountA],
        [legAccountB.id, legAccountB],
      ]);

      results.push({
        ...base,
        status: "FIXABLE",
        detail: "Ready to repair.",
        resolvedAccountId,
        resolvedToAccountId,
        resolvedAccountName: accountsById.get(resolvedAccountId)?.name ?? tx.account?.name ?? null,
        resolvedToAccountName: accountsById.get(resolvedToAccountId)?.name ?? tx.toAccount?.name ?? null,
      });
    }

    return results;
  }

  /**
   * Repairs only the transactionIds explicitly passed in — never "repair
   * everything" implicitly, so a caller (the API route) must always act on
   * a diagnosis the user actually saw. Re-diagnoses immediately before
   * writing, so a row that's no longer FIXABLE (already fixed elsewhere,
   * or genuinely ambiguous) is skipped rather than force-applied.
   */
  async repair(
    userId: string,
    transactionIds: string[]
  ): Promise<{ repaired: string[]; skipped: { transactionId: string; reason: string }[] }> {
    const diagnosis = await this.diagnose(userId);
    const byId = new Map(diagnosis.map((d) => [d.transactionId, d]));

    const repaired: string[] = [];
    const skipped: { transactionId: string; reason: string }[] = [];
    const touchedAccountIds = new Set<string>();

    for (const transactionId of transactionIds) {
      const candidate = byId.get(transactionId);
      if (!candidate || candidate.status !== "FIXABLE" || !candidate.resolvedAccountId || !candidate.resolvedToAccountId) {
        skipped.push({ transactionId, reason: candidate?.detail ?? "Not found or no longer needs repair." });
        continue;
      }

      const { resolvedAccountId, resolvedToAccountId } = candidate;

      try {
        await db.$transaction(async (tx) => {
          const before = await tx.transaction.findFirstOrThrow({ where: { id: transactionId, userId } });

          const data: Prisma.TransactionUpdateInput = {};
          if (!before.accountId) data.account = { connect: { id: resolvedAccountId } };
          if (!before.toAccountId) data.toAccount = { connect: { id: resolvedToAccountId } };
          if (Object.keys(data).length === 0) return;

          await tx.transaction.update({ where: { id: transactionId }, data });

          await AuditLogService.log(
            {
              userId,
              action: AuditAction.UPDATE,
              entityType: AuditEntityType.TRANSACTION,
              entityId: transactionId,
              before: { accountId: before.accountId, toAccountId: before.toAccountId },
              after: { accountId: resolvedAccountId, toAccountId: resolvedToAccountId },
              source: "TRANSFER_REPAIR",
            },
            tx
          );
        });

        touchedAccountIds.add(resolvedAccountId);
        touchedAccountIds.add(resolvedToAccountId);
        repaired.push(transactionId);
      } catch (err) {
        skipped.push({ transactionId, reason: err instanceof Error ? err.message : "Unknown error while repairing." });
      }
    }

    for (const accountId of touchedAccountIds) {
      await accountService.updateAccountBalance(userId, accountId);
    }

    return { repaired, skipped };
  }
}

export const transferRepairService = new TransferRepairService();
