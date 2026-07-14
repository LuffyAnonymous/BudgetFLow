import { db } from "@/lib/db";
import { Prisma, Debt } from "@prisma/client";

export class DebtRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<Debt | null> {
    return this.getClient(tx).debt.findFirst({
      where: { id, userId },
      include: { category: true },
    });
  }

  async findMany(userId: string, filters: { status?: Prisma.DebtWhereInput["status"] } = {}, tx?: Prisma.TransactionClient): Promise<Debt[]> {
    const whereClause: Prisma.DebtWhereInput = { userId };
    if (filters.status) {
      whereClause.status = filters.status;
    }
    return this.getClient(tx).debt.findMany({
      where: whereClause,
      include: { category: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(userId: string, data: Omit<Prisma.DebtUncheckedCreateInput, 'userId'>, tx?: Prisma.TransactionClient): Promise<Debt> {
    return this.getClient(tx).debt.create({
      data: {
        ...data,
        userId,
      },
      include: { category: true },
    });
  }

  async update(
    id: string,
    userId: string,
    data: Prisma.DebtUncheckedUpdateInput,
    expectedVersion?: number,
    tx?: Prisma.TransactionClient
  ): Promise<Debt> {
    const client = this.getClient(tx);
    if (expectedVersion !== undefined) {
      const result = await client.debt.updateMany({
        where: { id, userId, version: expectedVersion },
        data: {
          ...data,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        throw new Error("CONCURRENT_CONFLICT");
      }
    } else {
      await client.debt.update({
        where: { id, userId },
        data,
      });
    }

    const updated = await this.findById(id, userId, tx);
    if (!updated) {
      throw new Error("DEBT_NOT_FOUND");
    }
    return updated;
  }
}
