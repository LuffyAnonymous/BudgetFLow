import { db } from "@/lib/db";
import { Prisma, Notification } from "@prisma/client";

export interface NotificationFilters {
  unreadOnly?: boolean;
  dismissedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export class NotificationRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  async findById(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<Notification | null> {
    return this.getClient(tx).notification.findFirst({
      where: { id, userId },
    });
  }

  async findByEventKey(userId: string, eventKey: string, tx?: Prisma.TransactionClient): Promise<Notification | null> {
    return this.getClient(tx).notification.findFirst({
      where: { userId, eventKey },
    });
  }

  async findMany(
    userId: string,
    filters: NotificationFilters = {},
    tx?: Prisma.TransactionClient
  ): Promise<Notification[]> {
    const page = Math.max(1, filters.page ?? 1);
    const rawPageSize = filters.pageSize ?? 20;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = this.buildWhereClause(userId, filters);

    return this.getClient(tx).notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(
    userId: string,
    filters: Omit<NotificationFilters, "page" | "pageSize"> = {},
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const where = this.buildWhereClause(userId, filters);
    return this.getClient(tx).notification.count({ where });
  }

  async create(
    userId: string,
    data: Omit<Prisma.NotificationUncheckedCreateInput, "userId">,
    tx?: Prisma.TransactionClient
  ): Promise<Notification> {
    return this.getClient(tx).notification.create({
      data: {
        ...data,
        userId,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    data: Prisma.NotificationUncheckedUpdateInput,
    tx?: Prisma.TransactionClient
  ): Promise<Notification> {
    return this.getClient(tx).notification.update({
      where: { id, userId },
      data,
    });
  }

  async markAllRead(userId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await this.getClient(tx).notification.updateMany({
      where: { userId, readAt: null, dismissedAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  private buildWhereClause(userId: string, filters: NotificationFilters): Prisma.NotificationWhereInput {
    const where: Prisma.NotificationWhereInput = { userId };

    if (filters.unreadOnly) {
      where.readAt = null;
    }
    if (filters.dismissedOnly !== undefined) {
      if (filters.dismissedOnly) {
        where.dismissedAt = { not: null };
      } else {
        where.dismissedAt = null;
      }
    } else {
      // Default: hide dismissed notifications
      where.dismissedAt = null;
    }

    return where;
  }
}
