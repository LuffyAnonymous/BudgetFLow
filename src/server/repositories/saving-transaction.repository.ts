import { db } from "@/lib/db";
import { Prisma, SavingTransaction } from "@prisma/client";

export class SavingTransactionRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<SavingTransaction | null> {
    return this.getClient(tx).savingTransaction.findFirst({
      where: { id, userId },
      include: { transaction: true },
    });
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string, tx?: Prisma.TransactionClient): Promise<SavingTransaction | null> {
    return this.getClient(tx).savingTransaction.findFirst({
      where: { userId, idempotencyKey },
      include: { transaction: true },
    });
  }

  async findMany(
    userId: string,
    filters: { savingGoalId?: string; page?: number; pageSize?: number; startDate?: Date; endDate?: Date },
    tx?: Prisma.TransactionClient
  ): Promise<SavingTransaction[]> {
    const page = Math.max(1, filters.page ?? 1);
    const rawPageSize = filters.pageSize ?? 10;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = this.buildWhereClause(userId, filters);

    return this.getClient(tx).savingTransaction.findMany({
      where,
      orderBy: [
        { transactionDate: "desc" },
        { createdAt: "desc" },
      ],
      skip,
      take,
      include: {
        transaction: true,
      },
    });
  }

  async count(
    userId: string,
    filters: { savingGoalId?: string; startDate?: Date; endDate?: Date },
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const where = this.buildWhereClause(userId, filters);
    return this.getClient(tx).savingTransaction.count({ where });
  }

  async create(
    userId: string,
    data: Omit<Prisma.SavingTransactionUncheckedCreateInput, 'userId'>,
    tx?: Prisma.TransactionClient
  ): Promise<SavingTransaction> {
    return this.getClient(tx).savingTransaction.create({
      data: {
        ...data,
        userId,
      },
      include: {
        transaction: true,
      },
    });
  }

  private buildWhereClause(
    userId: string,
    filters: { savingGoalId?: string; startDate?: Date; endDate?: Date }
  ): Prisma.SavingTransactionWhereInput {
    const where: Prisma.SavingTransactionWhereInput = { userId };

    if (filters.savingGoalId) {
      where.savingGoalId = filters.savingGoalId;
    }

    if (filters.startDate || filters.endDate) {
      where.transactionDate = {};
      if (filters.startDate) {
        where.transactionDate.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.transactionDate.lte = filters.endDate;
      }
    }

    return where;
  }
}
