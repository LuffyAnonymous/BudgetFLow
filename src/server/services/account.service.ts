import { db } from "@/lib/db";
import { Account, AccountType, Prisma, TransactionType, TransferMatchStatus } from "@prisma/client";
import { Decimal } from "decimal.js";

export class AccountService {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  /**
   * Auto-provisions the default accounts for a user if they do not exist.
   */
  async ensureDefaultAccounts(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = this.getClient(tx);
    const defaultAccounts = [
      { name: "Emirates NBD", type: AccountType.EMIRATES_NBD },
      { name: "Cash", type: AccountType.CASH },
    ];

    // Read existing accounts first
    const existing = await client.account.findMany({
      where: { userId },
    });
    const existingTypes = existing.map((a) => a.type);

    for (const def of defaultAccounts) {
      if (!existingTypes.includes(def.type)) {
        await client.account.create({
          data: {
            userId,
            name: def.name,
            type: def.type,
            currentBalance: new Prisma.Decimal(0),
            latestImportedBalance: null,
            lastSMSImportedAt: null,
            lastSuccessfulSyncAt: null,
          },
        });
      }
    }
  }

  /**
   * Find-or-create an Account for a specific institution, keyed by
   * (userId, name) — the same uniqueness the DB already enforces. Used by
   * the SMS import pipeline so a new bank/BNPL/wallet sender gets its own
   * tracked account the first time it's actually seen, rather than every
   * user being pre-provisioned with every possible institution.
   */
  async ensureAccountForInstitution(
    userId: string,
    institution: { type: AccountType; name: string; isCreditCard?: boolean },
    tx?: Prisma.TransactionClient
  ): Promise<Account> {
    const client = this.getClient(tx);
    const existing = await client.account.findUnique({
      where: { userId_name: { userId, name: institution.name } },
    });
    if (existing) return existing;

    return client.account.create({
      data: {
        userId,
        name: institution.name,
        type: institution.type,
        isCreditCard: institution.isCreditCard ?? false,
        currentBalance: new Prisma.Decimal(0),
        latestImportedBalance: null,
        lastSMSImportedAt: null,
        lastSuccessfulSyncAt: null,
      },
    });
  }

  /**
   * Retrieves all accounts for a user, ensuring defaults exist first.
   */
  async getAccounts(userId: string, tx?: Prisma.TransactionClient): Promise<Account[]> {
    await this.ensureDefaultAccounts(userId, tx);
    return this.getClient(tx).account.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Sums transaction activity for one account: INCOME + TRANSFER-in as
   * inflows, EXPENSE/SAVINGS/DEBT_PAYMENT/REMITTANCE/TRANSFER-out as
   * outflows, added to `baseBalance`. The single source of truth both
   * updateAccountBalance() and reconcileAccountBalance() build on —
   * previously each had its own near-identical copy that had quietly
   * drifted apart, so they disagreed by design and "Recalculating" never
   * cleared.
   *
   * `since`, when given, restricts the sum to transactions that really
   * happened after that moment — used to anchor onto a bank-reported
   * latestImportedBalance checkpoint instead of assuming the ledger holds
   * every transaction back to account opening (it usually doesn't: pre-app
   * history is real but untracked). Filters on `occurredAt` — not `date`
   * (the midnight-truncated financialDate, which silently dropped every
   * same-calendar-day transaction against a precise checkpoint) and not
   * `createdAt` (DB insert/processing time, which for a backfilled or
   * resynced import can be wildly out of order relative to when the
   * transactions actually happened, double-counting or dropping activity
   * relative to an anchor set by a different, out-of-order message). Omit
   * `since` (and leave `baseBalance` at 0) to sum the complete history from
   * scratch instead.
   */
  private async computeLedgerBalance(
    userId: string,
    accountId: string,
    client: Prisma.TransactionClient | typeof db,
    baseBalance: Decimal = new Decimal(0),
    since: Date | null = null
  ): Promise<Decimal> {
    const sinceFilter = since ? { occurredAt: { gt: since } } : {};
    // A MERGED row (see TransferMatchStatus) was the "other leg" of a
    // transfer folded into a MATCHED TRANSFER row elsewhere — its own
    // balance effect is superseded by that row, so it must never be summed
    // here too, or the destination account's inflow gets double-counted.
    // The row itself is kept forever for history; only its contribution to
    // this recompute is excluded.
    const notMergedFilter = { transferMatchStatus: { not: TransferMatchStatus.MERGED } };

    const incomeAgg = await client.transaction.aggregate({
      where: { userId, accountId, type: TransactionType.INCOME, ...notMergedFilter, ...sinceFilter },
      _sum: { amount: true },
    });
    const transferInAgg = await client.transaction.aggregate({
      where: { userId, toAccountId: accountId, type: TransactionType.TRANSFER, ...notMergedFilter, ...sinceFilter },
      _sum: { amount: true },
    });

    const inflows = new Decimal(incomeAgg._sum.amount?.toString() || "0")
      .add(new Decimal(transferInAgg._sum.amount?.toString() || "0"));

    const outflowAgg = await client.transaction.aggregate({
      where: {
        userId,
        accountId,
        type: {
          in: [
            TransactionType.EXPENSE,
            TransactionType.SAVINGS,
            TransactionType.DEBT_PAYMENT,
            TransactionType.REMITTANCE,
            TransactionType.TRANSFER,
          ],
        },
        ...notMergedFilter,
        ...sinceFilter,
      },
      _sum: { amount: true },
    });

    const outflows = new Decimal(outflowAgg._sum.amount?.toString() || "0");

    return baseBalance.add(inflows).minus(outflows);
  }

  /**
   * Recalculates the balance of a specific account using the ledger as the source of truth,
   * then caches/updates the currentBalance column on the Account record.
   *
   * `forceFullRecompute`, when true, ignores the latestImportedBalance/
   * latestImportedBalanceAt anchor entirely and sums the complete
   * transaction history from zero instead. The anchored path is what
   * normal ingestion uses (cheap — it doesn't re-sum an account's entire
   * history on every single new transaction), but the anchor itself is
   * only as correct as whatever set it; if it was ever corrupted by an
   * out-of-order backfill *before* that got fixed, an anchored recompute
   * inherits the corruption instead of curing it. A full from-zero sum has
   * no such dependency — this is what the user-facing "Recalculate
   * Balances" button uses, precisely so it's always a genuine fix.
   */
  async updateAccountBalance(
    userId: string,
    accountId: string,
    tx?: Prisma.TransactionClient,
    forceFullRecompute: boolean = false
  ): Promise<Decimal> {
    const client = this.getClient(tx);

    const account = forceFullRecompute
      ? null
      : await client.account.findUnique({
          where: { id: accountId },
          select: { latestImportedBalance: true, latestImportedBalanceAt: true },
        });
    const baseBalance = account?.latestImportedBalance
      ? new Decimal(account.latestImportedBalance.toString())
      : new Decimal(0);
    const since = account?.latestImportedBalance ? account.latestImportedBalanceAt : null;

    const derivedBalance = await this.computeLedgerBalance(userId, accountId, client, baseBalance, since);

    await client.account.update({
      where: { id: accountId, userId },
      data: {
        currentBalance: derivedBalance,
      },
    });

    return derivedBalance;
  }

  /**
   * Helper to recalculate balances for all accounts of a user.
   */
  async updateAllBalances(
    userId: string,
    tx?: Prisma.TransactionClient,
    forceFullRecompute: boolean = false
  ): Promise<void> {
    const client = this.getClient(tx);
    const accounts = await client.account.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const acc of accounts) {
      await this.updateAccountBalance(userId, acc.id, tx, forceFullRecompute);
    }
  }

  async reconcileAccountBalance(
    userId: string,
    accountId: string,
    tx?: Prisma.TransactionClient
  ): Promise<{
    cachedBalance: Decimal;
    ledgerBalance: Decimal;
    latestImportedBalance: Decimal | null;
    cacheDifference: Decimal;
    bankDifference: Decimal | null;
    reconciliationStatus: "MATCHED" | "CACHE_MISMATCH" | "BANK_BALANCE_DIFFERENCE" | "REVIEW_REQUIRED";
    reconciledAt: Date;
  }> {
    const client = this.getClient(tx);

    const account = await client.account.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    const latestImportedBalance = account.latestImportedBalance
      ? new Decimal(account.latestImportedBalance.toString())
      : null;

    // Anchored the same way updateAccountBalance() derives currentBalance —
    // cacheDifference is "would a fresh recompute, by the same method,
    // land on what's cached right now," so it must use the same method.
    const ledgerBalance = await this.computeLedgerBalance(
      userId,
      accountId,
      client,
      latestImportedBalance ?? new Decimal(0),
      latestImportedBalance ? account.latestImportedBalanceAt : null
    );

    // Full history from zero, deliberately NOT anchored — bankDifference
    // asks a different question: "if every transaction we've ever recorded
    // is correct and complete, does replaying all of it from scratch land
    // on what the bank itself last reported," a data-completeness check
    // that an anchored sum can't answer (it would trivially match its own
    // anchor).
    const fullHistoryBalance = await this.computeLedgerBalance(userId, accountId, client);

    const cachedBalance = new Decimal(account.currentBalance.toString());
    const cacheDifference = cachedBalance.minus(ledgerBalance);
    const bankDifference = latestImportedBalance
      ? fullHistoryBalance.minus(latestImportedBalance)
      : null;

    let reconciliationStatus: "MATCHED" | "CACHE_MISMATCH" | "BANK_BALANCE_DIFFERENCE" | "REVIEW_REQUIRED" = "MATCHED";

    if (!cacheDifference.isZero()) {
      reconciliationStatus = "CACHE_MISMATCH";
    } else if (latestImportedBalance && !bankDifference?.isZero()) {
      reconciliationStatus = "BANK_BALANCE_DIFFERENCE";
    }

    return {
      cachedBalance,
      ledgerBalance,
      latestImportedBalance,
      cacheDifference,
      bankDifference,
      reconciliationStatus,
      reconciledAt: new Date(),
    };
  }

  /**
   * Designates one account as the user's primary — unsets any other primary
   * first so the partial unique index (Account_userId_isPrimary_unique)
   * never has more than one true value per user to enforce against.
   */
  async setPrimaryAccount(userId: string, accountId: string): Promise<Account> {
    return db.$transaction(async (tx) => {
      const account = await tx.account.findFirst({ where: { id: accountId, userId } });
      if (!account) {
        throw new Error("ACCOUNT_NOT_FOUND: Account not found or unauthorized.");
      }

      await tx.account.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });

      return tx.account.update({
        where: { id: accountId },
        data: { isPrimary: true },
      });
    });
  }

  /** Returns the user's primary account, or null if none has been set yet. */
  async getPrimaryAccount(userId: string, tx?: Prisma.TransactionClient): Promise<Account | null> {
    return this.getClient(tx).account.findFirst({ where: { userId, isPrimary: true } });
  }

  /**
   * Sum of currentBalance across every real, spendable account — the same
   * "Total Available Money" figure the Accounts page headline shows
   * (accounts-client.tsx's own identical filter), and the single source of
   * truth the dashboard's "Remaining Cash Flow" now mirrors too, so the two
   * screens can never show a different number for "how much money do I
   * actually have." Excludes BNPL (Tabby/Tamara) and credit-card accounts —
   * their balance is money owed, not money to spend.
   */
  async getTotalAvailableMoney(userId: string, tx?: Prisma.TransactionClient): Promise<Decimal> {
    const accounts = await this.getAccounts(userId, tx);
    const BNPL_TYPES = new Set<AccountType>([AccountType.TABBY, AccountType.TAMARA]);
    return accounts
      .filter((a) => !a.isCreditCard && !BNPL_TYPES.has(a.type))
      .reduce((sum, a) => sum.plus(a.currentBalance), new Decimal(0));
  }
}

export const accountService = new AccountService();
