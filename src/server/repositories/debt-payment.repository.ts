import { db } from "@/lib/db";
import { Prisma, DebtPayment } from "@prisma/client";

export class DebtPaymentRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<DebtPayment | null> {
    return this.getClient(tx).debtPayment.findFirst({
      where: { id, userId },
      include: { transaction: true },
    });
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string, tx?: Prisma.TransactionClient): Promise<DebtPayment | null> {
    return this.getClient(tx).debtPayment.findFirst({
      where: { userId, idempotencyKey },
      include: { transaction: true },
    });
  }

  async findMany(
    userId: string,
    filters: { debtId?: string; page?: number; pageSize?: number; startDate?: Date; endDate?: Date },
    tx?: Prisma.TransactionClient
  ): Promise<DebtPayment[]> {
    const page = Math.max(1, filters.page ?? 1);
    const rawPageSize = filters.pageSize ?? 10;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = this.buildWhereClause(userId, filters);

    return this.getClient(tx).debtPayment.findMany({
      where,
      orderBy: [
        { paymentDate: "desc" },
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
    filters: { debtId?: string; startDate?: Date; endDate?: Date },
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const where = this.buildWhereClause(userId, filters);
    return this.getClient(tx).debtPayment.count({ where });
  }

  async create(
    userId: string,
    data: Omit<Prisma.DebtPaymentUncheckedCreateInput, 'userId'>,
    tx?: Prisma.TransactionClient
  ): Promise<DebtPayment> {
    return this.getClient(tx).debtPayment.create({
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
    filters: { debtId?: string; startDate?: Date; endDate?: Date }
  ): Prisma.DebtPaymentWhereInput {
    const where: Prisma.DebtPaymentWhereInput = { userId };

    if (filters.debtId) {
      where.debtId = filters.debtId;
    }

    if (filters.startDate || filters.endDate) {
      where.paymentDate = {};
      if (filters.startDate) {
        where.paymentDate.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.paymentDate.lte = filters.endDate;
      }
    }

    return where;
  }
}
