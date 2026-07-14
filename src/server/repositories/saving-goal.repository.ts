import { db } from "@/lib/db";
import { Prisma, SavingGoal } from "@prisma/client";

export class SavingGoalRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<SavingGoal | null> {
    return this.getClient(tx).savingGoal.findFirst({
      where: { id, userId },
      include: { category: true },
    });
  }

  async findMany(userId: string, filters: { status?: Prisma.SavingGoalWhereInput["status"] } = {}, tx?: Prisma.TransactionClient): Promise<SavingGoal[]> {
    const whereClause: Prisma.SavingGoalWhereInput = { userId };
    if (filters.status) {
      whereClause.status = filters.status;
    }
    return this.getClient(tx).savingGoal.findMany({
      where: whereClause,
      include: { category: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(userId: string, data: Omit<Prisma.SavingGoalUncheckedCreateInput, 'userId'>, tx?: Prisma.TransactionClient): Promise<SavingGoal> {
    return this.getClient(tx).savingGoal.create({
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
    data: Prisma.SavingGoalUncheckedUpdateInput,
    expectedVersion?: number,
    tx?: Prisma.TransactionClient
  ): Promise<SavingGoal> {
    const client = this.getClient(tx);
    if (expectedVersion !== undefined) {
      const result = await client.savingGoal.updateMany({
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
      await client.savingGoal.update({
        where: { id, userId },
        data,
      });
    }

    const updated = await this.findById(id, userId, tx);
    if (!updated) {
      throw new Error("SAVING_GOAL_NOT_FOUND");
    }
    return updated;
  }
}
