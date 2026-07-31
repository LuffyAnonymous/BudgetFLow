import { db } from "@/lib/db";
import { Category, CategoryType, Prisma } from "@prisma/client";

export class CategoryRepository {
  private getClient(tx?: Prisma.TransactionClient) {
    return tx || db;
  }

  /**
   * Finds all categories belonging to the user.
   */
  async findManyByUserId(userId: string, tx?: Prisma.TransactionClient): Promise<Category[]> {
    return this.getClient(tx).category.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Creates a new category for the user.
   */
  async create(
    userId: string,
    data: { name: string; type: CategoryType; budgetGroupKey?: string | null },
    tx?: Prisma.TransactionClient
  ): Promise<Category> {
    return this.getClient(tx).category.create({
      data: {
        userId,
        name: data.name,
        type: data.type,
        budgetGroupKey: data.budgetGroupKey ?? null,
      },
    });
  }

  /**
   * Finds a category by ID and ensures it belongs to the user.
   */
  async findByIdAndUserId(id: string, userId: string, tx?: Prisma.TransactionClient): Promise<Category | null> {
    return this.getClient(tx).category.findFirst({
      where: { id, userId },
    });
  }
}
