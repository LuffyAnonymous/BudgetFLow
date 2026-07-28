import { db } from "@/lib/db";
import { Prisma, Transaction } from "@prisma/client";
import {
  CreateTransactionData,
  UpdateTransactionData,
  TransactionFilters,
} from "@/features/transactions/types/transaction.types";

export class TransactionRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  /**
   * Finds many transactions matching criteria, scoped by userId.
   */
  async findMany(
    userId: string,
    filters: TransactionFilters,
    tx?: Prisma.TransactionClient
  ): Promise<Transaction[]> {
    const page = Math.max(1, filters.page ?? 1);
    const rawPageSize = filters.pageSize ?? 10;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = this.buildWhereClause(userId, filters);

    return this.getClient(tx).transaction.findMany({
      where,
      orderBy: [
        { date: "desc" },
        { createdAt: "desc" },
      ],
      skip,
      take,
      include: {
        category: true,
      },
    });
  }

  /**
   * Returns count of matching transactions, scoped by userId.
   */
  async count(userId: string, filters: TransactionFilters, tx?: Prisma.TransactionClient): Promise<number> {
    const where = this.buildWhereClause(userId, filters);
    return this.getClient(tx).transaction.count({ where });
  }

  /**
   * Finds a single transaction by ID and userId.
   */
  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<Transaction | null> {
    return this.getClient(tx).transaction.findFirst({
      where: { id, userId },
      include: {
        category: true,
      },
    });
  }

  /**
   * Creates a transaction.
   */
  async create(userId: string, data: CreateTransactionData, tx?: Prisma.TransactionClient): Promise<Transaction> {
    return this.getClient(tx).transaction.create({
      data: {
        userId,
        date: data.date,
        budgetMonth: data.budgetMonth !== undefined ? data.budgetMonth : undefined,
        categoryId: data.categoryId,
        description: data.description,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        notes: data.notes,
        type: data.type,
        cashFlowDirection: data.cashFlowDirection || null,
        origin: data.origin || undefined,
        accountId: data.accountId || null,
        toAccountId: data.toAccountId || null,
      },
      include: {
        category: true,
      },
    });
  }

  /**
   * Updates a transaction. Scoped by ID and userId.
   */
  async update(
    id: string,
    userId: string,
    data: UpdateTransactionData,
    tx?: Prisma.TransactionClient
  ): Promise<Transaction> {
    const client = this.getClient(tx);
    
    // Verify first
    const existing = await client.transaction.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new Error("Transaction not found or unauthorized");
    }

    return client.transaction.update({
      where: { id, userId },
      data: {
        date: data.date,
        budgetMonth: data.budgetMonth !== undefined ? data.budgetMonth : undefined,
        categoryId: data.categoryId,
        description: data.description,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        notes: data.notes,
        type: data.type,
        cashFlowDirection: data.cashFlowDirection,
        origin: data.origin,
        accountId: data.accountId !== undefined ? data.accountId : undefined,
        toAccountId: data.toAccountId !== undefined ? data.toAccountId : undefined,
      },
      include: {
        category: true,
      },
    });
  }

  /**
   * Deletes a transaction. Scoped by ID and userId.
   */
  async delete(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<Transaction> {
    const client = this.getClient(tx);
    const existing = await client.transaction.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new Error("Transaction not found or unauthorized");
    }

    return client.transaction.delete({
      where: { id, userId },
    });
  }

  /**
   * Finds transactions inside a specific UTC Date range or budgetMonth.
   */
  async findManyInRange(userId: string, start: Date, end: Date, monthStr?: string, tx?: Prisma.TransactionClient): Promise<Transaction[]> {
    const where: Prisma.TransactionWhereInput = {
      userId,
      ...(monthStr
        ? {
            OR: [
              { budgetMonth: monthStr },
              {
                budgetMonth: null,
                date: { gte: start, lt: end },
              },
            ],
          }
        : {
            date: { gte: start, lt: end },
          }),
    };

    return this.getClient(tx).transaction.findMany({
      where,
      include: {
        category: true,
      },
      orderBy: { date: "desc" },
    });
  }

  /**
   * Helper to compile strict Prisma search filters.
   */
  private buildWhereClause(
    userId: string,
    filters: TransactionFilters
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {
      userId,
    };

    if (filters.budgetMonth) {
      where.OR = [
        { budgetMonth: filters.budgetMonth },
        {
          budgetMonth: null,
          ...(filters.startDate || filters.endDate
            ? {
                date: {
                  ...(filters.startDate ? { gte: filters.startDate } : {}),
                  ...(filters.endDate ? { lte: filters.endDate } : {}),
                },
              }
            : {}),
        },
      ];
    } else if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) {
        where.date.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.date.lte = filters.endDate;
      }
    }

    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters.type) {
      where.type = filters.type;
    }

    if (filters.search) {
      const trimmedSearch = filters.search.trim().slice(0, 50);
      if (trimmedSearch) {
        const searchConditions: Prisma.TransactionWhereInput[] = [
          { description: { contains: trimmedSearch, mode: "insensitive" } },
          { notes: { contains: trimmedSearch, mode: "insensitive" } },
          { paymentMethod: { contains: trimmedSearch, mode: "insensitive" } },
        ];

        if (where.OR) {
          where.AND = [
            { OR: where.OR },
            { OR: searchConditions },
          ];
          delete where.OR;
        } else {
          where.OR = searchConditions;
        }
      }
    }

    return where;
  }
}
