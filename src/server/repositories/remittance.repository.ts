import { db } from "@/lib/db";
import { Prisma, Remittance } from "@prisma/client";

export interface RemittanceFilters {
  page?: number;
  pageSize?: number;
  startDate?: Date;
  endDate?: Date;
  recipient?: string;
  transferProvider?: string;
  status?: Prisma.RemittanceWhereInput["status"];
  includeArchived?: boolean;
}

export class RemittanceRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<Remittance | null> {
    return this.getClient(tx).remittance.findFirst({
      where: { id, userId },
      include: {
        transaction: true,
        reversalTransaction: true,
        category: true,
      },
    });
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string, tx?: Prisma.TransactionClient): Promise<Remittance | null> {
    return this.getClient(tx).remittance.findFirst({
      where: { userId, idempotencyKey },
      include: {
        transaction: true,
        reversalTransaction: true,
        category: true,
      },
    });
  }

  async findByReversalIdempotencyKey(userId: string, reversalIdempotencyKey: string, tx?: Prisma.TransactionClient): Promise<Remittance | null> {
    return this.getClient(tx).remittance.findFirst({
      where: { userId, reversalIdempotencyKey },
      include: {
        transaction: true,
        reversalTransaction: true,
        category: true,
      },
    });
  }

  async findMany(
    userId: string,
    filters: RemittanceFilters = {},
    tx?: Prisma.TransactionClient
  ): Promise<Remittance[]> {
    const page = Math.max(1, filters.page ?? 1);
    const rawPageSize = filters.pageSize ?? 10;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = this.buildWhereClause(userId, filters);

    return this.getClient(tx).remittance.findMany({
      where,
      orderBy: [
        { transferDate: "desc" },
        { createdAt: "desc" },
      ],
      skip,
      take,
      include: {
        transaction: true,
        reversalTransaction: true,
        category: true,
      },
    });
  }

  async count(
    userId: string,
    filters: Omit<RemittanceFilters, "page" | "pageSize"> = {},
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const where = this.buildWhereClause(userId, filters);
    return this.getClient(tx).remittance.count({ where });
  }

  async create(
    userId: string,
    data: Omit<Prisma.RemittanceUncheckedCreateInput, "userId">,
    tx?: Prisma.TransactionClient
  ): Promise<Remittance> {
    return this.getClient(tx).remittance.create({
      data: {
        ...data,
        userId,
      },
      include: {
        transaction: true,
        reversalTransaction: true,
        category: true,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    data: Prisma.RemittanceUncheckedUpdateInput,
    expectedVersion?: number,
    tx?: Prisma.TransactionClient
  ): Promise<Remittance> {
    const client = this.getClient(tx);
    if (expectedVersion !== undefined) {
      const result = await client.remittance.updateMany({
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
      await client.remittance.update({
        where: { id, userId },
        data,
      });
    }

    const updated = await this.findById(id, userId, tx);
    if (!updated) {
      throw new Error("REMITTANCE_NOT_FOUND");
    }
    return updated;
  }

  private buildWhereClause(userId: string, filters: RemittanceFilters): Prisma.RemittanceWhereInput {
    const where: Prisma.RemittanceWhereInput = { userId };

    if (filters.status) {
      where.status = filters.status;
    }

    // Default: hide archived unless specified
    if (!filters.includeArchived) {
      where.archivedAt = null;
    }

    if (filters.startDate || filters.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.startDate) {
        dateFilter.gte = filters.startDate;
      }
      if (filters.endDate) {
        dateFilter.lt = filters.endDate;
      }
      where.transferDate = dateFilter;
    }

    if (filters.recipient) {
      where.recipient = {
        contains: filters.recipient,
        mode: "insensitive",
      };
    }

    if (filters.transferProvider) {
      where.transferProvider = {
        equals: filters.transferProvider,
        mode: "insensitive",
      };
    }

    return where;
  }
}
