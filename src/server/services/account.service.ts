import { db } from "@/lib/db";
import { Account, AccountType, Prisma, TransactionType } from "@prisma/client";
import { Decimal } from "decimal.js";

export class AccountService {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  /**
   * Auto-provisions the 3 default accounts for a user if they do not exist.
   */
  async ensureDefaultAccounts(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = this.getClient(tx);
    const defaultAccounts = [
      { name: "Emirates NBD", type: AccountType.EMIRATES_NBD },
      { name: "Mashreq", type: AccountType.MASHREQ },
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
   * Recalculates the balance of a specific account using the ledger as the source of truth,
   * then caches/updates the currentBalance column on the Account record.
   */
  async updateAccountBalance(
    userId: string,
    accountId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Decimal> {
    const client = this.getClient(tx);

    const account = await client.account.findUnique({
      where: { id: accountId },
      select: { latestImportedBalance: true, lastSMSImportedAt: true }
    });

    let baseBalance = new Decimal(0);
    let filterDate: Date | null = null;

    if (
      account?.latestImportedBalance !== null &&
      account?.latestImportedBalance !== undefined &&
      account?.lastSMSImportedAt !== null &&
      account?.lastSMSImportedAt !== undefined
    ) {
      baseBalance = new Decimal(account.latestImportedBalance.toString());
      filterDate = account.lastSMSImportedAt;
    }

    // 1. Calculate Inflows: INCOME (primary) + TRANSFER (destination)
    const incomeAgg = await client.transaction.aggregate({
      where: {
        userId,
        accountId,
        type: TransactionType.INCOME,
        ...(filterDate ? { date: { gt: filterDate } } : {}),
      },
      _sum: { amount: true },
    });
    const transferInAgg = await client.transaction.aggregate({
      where: {
        userId,
        toAccountId: accountId,
        type: TransactionType.TRANSFER,
        ...(filterDate ? { date: { gt: filterDate } } : {}),
      },
      _sum: { amount: true },
    });

    const inflows = new Decimal(incomeAgg._sum.amount?.toString() || "0")
      .add(new Decimal(transferInAgg._sum.amount?.toString() || "0"));

    // 2. Calculate Outflows: EXPENSE, SAVINGS, DEBT_PAYMENT, REMITTANCE, TRANSFER (source)
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
        ...(filterDate ? { date: { gt: filterDate } } : {}),
      },
      _sum: { amount: true },
    });

    const outflows = new Decimal(outflowAgg._sum.amount?.toString() || "0");

    const derivedBalance = baseBalance.add(inflows).minus(outflows);

    // 3. Update the cached balance on the Account model
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
  async updateAllBalances(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = this.getClient(tx);
    const accounts = await client.account.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const acc of accounts) {
      await this.updateAccountBalance(userId, acc.id, tx);
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

    const incomeAgg = await client.transaction.aggregate({
      where: { userId, accountId, type: TransactionType.INCOME },
      _sum: { amount: true },
    });
    const transferInAgg = await client.transaction.aggregate({
      where: { userId, toAccountId: accountId, type: TransactionType.TRANSFER },
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
      },
      _sum: { amount: true },
    });

    const outflows = new Decimal(outflowAgg._sum.amount?.toString() || "0");
    const ledgerBalance = inflows.minus(outflows);

    const cachedBalance = new Decimal(account.currentBalance.toString());
    const latestImportedBalance = account.latestImportedBalance
      ? new Decimal(account.latestImportedBalance.toString())
      : null;

    const cacheDifference = cachedBalance.minus(ledgerBalance);
    const bankDifference = latestImportedBalance
      ? ledgerBalance.minus(latestImportedBalance)
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
}

export const accountService = new AccountService();
