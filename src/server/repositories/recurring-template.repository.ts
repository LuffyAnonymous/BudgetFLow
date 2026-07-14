import { db } from "@/lib/db";
import { Prisma, RecurringTemplate } from "@prisma/client";

export class RecurringTemplateRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<RecurringTemplate | null> {
    return this.getClient(tx).recurringTemplate.findFirst({
      where: { id, userId },
      include: {
        category: true,
      },
    });
  }

  async findMany(
    userId: string,
    filters: { status?: Prisma.RecurringTemplateWhereInput["status"] } = {},
    tx?: Prisma.TransactionClient
  ): Promise<RecurringTemplate[]> {
    const where: Prisma.RecurringTemplateWhereInput = { userId };
    if (filters.status) {
      where.status = filters.status;
    }
    return this.getClient(tx).recurringTemplate.findMany({
      where,
      include: {
        category: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(
    userId: string,
    data: Omit<Prisma.RecurringTemplateUncheckedCreateInput, "userId">,
    tx?: Prisma.TransactionClient
  ): Promise<RecurringTemplate> {
    return this.getClient(tx).recurringTemplate.create({
      data: {
        ...data,
        userId,
      },
      include: {
        category: true,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    data: Prisma.RecurringTemplateUncheckedUpdateInput,
    tx?: Prisma.TransactionClient
  ): Promise<RecurringTemplate> {
    return this.getClient(tx).recurringTemplate.update({
      where: { id, userId },
      data,
      include: {
        category: true,
      },
    });
  }
}
