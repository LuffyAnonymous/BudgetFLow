import { db } from "@/lib/db";
import { Prisma, RecurringOccurrence } from "@prisma/client";

export class RecurringOccurrenceRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<RecurringOccurrence | null> {
    return this.getClient(tx).recurringOccurrence.findFirst({
      where: { id, userId },
      include: {
        template: {
          include: { category: true },
        },
        linkedTransaction: true,
      },
    });
  }

  async findByTemplateIdAndDate(
    userId: string,
    recurringTemplateId: string,
    scheduledDate: Date,
    tx?: Prisma.TransactionClient
  ): Promise<RecurringOccurrence | null> {
    return this.getClient(tx).recurringOccurrence.findFirst({
      where: { userId, recurringTemplateId, scheduledDate },
      include: {
        template: {
          include: { category: true },
        },
        linkedTransaction: true,
      },
    });
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    tx?: Prisma.TransactionClient
  ): Promise<RecurringOccurrence | null> {
    return this.getClient(tx).recurringOccurrence.findFirst({
      where: { userId, idempotencyKey },
      include: {
        template: {
          include: { category: true },
        },
        linkedTransaction: true,
      },
    });
  }

  async findMany(
    userId: string,
    filters: {
      status?: Prisma.RecurringOccurrenceWhereInput["status"];
      templateId?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
    tx?: Prisma.TransactionClient
  ): Promise<RecurringOccurrence[]> {
    const where: Prisma.RecurringOccurrenceWhereInput = { userId };
    
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.templateId) {
      where.recurringTemplateId = filters.templateId;
    }
    if (filters.startDate || filters.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.startDate) dateFilter.gte = filters.startDate;
      if (filters.endDate) dateFilter.lt = filters.endDate;
      where.scheduledDate = dateFilter;
    }

    return this.getClient(tx).recurringOccurrence.findMany({
      where,
      include: {
        template: {
          include: { category: true },
        },
        linkedTransaction: true,
      },
      orderBy: { scheduledDate: "asc" },
    });
  }

  async create(
    userId: string,
    data: Omit<Prisma.RecurringOccurrenceUncheckedCreateInput, "userId">,
    tx?: Prisma.TransactionClient
  ): Promise<RecurringOccurrence> {
    return this.getClient(tx).recurringOccurrence.create({
      data: {
        ...data,
        userId,
      },
      include: {
        template: {
          include: { category: true },
        },
        linkedTransaction: true,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    data: Prisma.RecurringOccurrenceUncheckedUpdateInput,
    tx?: Prisma.TransactionClient
  ): Promise<RecurringOccurrence> {
    return this.getClient(tx).recurringOccurrence.update({
      where: { id, userId },
      data,
      include: {
        template: {
          include: { category: true },
        },
        linkedTransaction: true,
      },
    });
  }
}
