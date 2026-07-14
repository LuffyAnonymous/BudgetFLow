import { TransactionRepository } from "../repositories/transaction.repository";
import { CategoryRepository } from "../repositories/category.repository";
import {
  CreateTransactionData,
  UpdateTransactionData,
  TransactionFilters,
} from "@/features/transactions/types/transaction.types";
import { CategoryType, Transaction, TransactionType } from "@prisma/client";
import { db } from "@/lib/db";
import { AuditLogService } from "./audit-log.service";
import { AuditAction, AuditEntityType } from "@prisma/client";

export class TransactionService {
  private transactionRepo = new TransactionRepository();
  private categoryRepo = new CategoryRepository();

  /**
   * Fetches paginated transactions for a user.
   */
  async getTransactions(
    userId: string,
    filters: TransactionFilters
  ): Promise<{
    items: Transaction[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  }> {
    const totalItems = await this.transactionRepo.count(userId, filters);
    const items = await this.transactionRepo.findMany(userId, filters);

    const page = Math.max(1, filters.page ?? 1);
    const rawPageSize = filters.pageSize ?? 10;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    return {
      items,
      page,
      pageSize,
      totalItems,
      totalPages,
    };
  }

  /**
   * Fetches a transaction by ID.
   */
  async getTransactionById(id: string, userId: string): Promise<Transaction | null> {
    return this.transactionRepo.findById(id, userId);
  }

  /**
   * Creates a new transaction with transactional audit logging.
   */
  async createTransaction(userId: string, data: CreateTransactionData): Promise<Transaction> {
    // 1. Validate category ownership
    const category = await this.categoryRepo.findByIdAndUserId(data.categoryId, userId);
    if (!category) {
      throw new Error("INVALID_CATEGORY: The selected category does not exist or does not belong to you.");
    }

    // 2. Validate category type compatibility
    this.validateCategoryCompatibility(data.type, category.type);

    // 3. Create transaction, log audit, and update balances atomically
    const { accountService } = await import("./account.service");
    return db.$transaction(async (tx) => {
      const created = await this.transactionRepo.create(userId, data, tx);
      await AuditLogService.log(
        {
          userId,
          action: AuditAction.CREATE,
          entityType: AuditEntityType.TRANSACTION,
          entityId: created.id,
          after: {
            id: created.id,
            type: created.type,
            amount: created.amount.toString(),
            categoryId: created.categoryId,
            description: created.description,
            date: created.date.toISOString(),
          },
        },
        tx
      );

      // Recalculate balances for accounts involved
      if (created.accountId) {
        await accountService.updateAccountBalance(userId, created.accountId, tx);
      }
      if (created.toAccountId) {
        await accountService.updateAccountBalance(userId, created.toAccountId, tx);
      }

      return created;
    });
  }

  /**
   * Updates an existing transaction with transactional audit logging and balance updates.
   */
  async updateTransaction(
    id: string,
    userId: string,
    data: UpdateTransactionData
  ): Promise<Transaction> {
    // 1. Verify existence first
    const existing = await this.transactionRepo.findById(id, userId);
    if (!existing) {
      throw new Error("TRANSACTION_NOT_FOUND: The selected transaction was not found or you do not have permission to modify it.");
    }

    // 2. Validate category ownership if changing
    const finalType = data.type ?? existing.type;
    const finalCategoryId = data.categoryId ?? existing.categoryId;
    const category = await this.categoryRepo.findByIdAndUserId(finalCategoryId, userId);
    if (!category) {
      throw new Error("INVALID_CATEGORY: The selected category does not exist or does not belong to you.");
    }

    // 3. Validate category compatibility
    this.validateCategoryCompatibility(finalType, category.type);

    // 4. Update + audit + balance sync atomically
    const { accountService } = await import("./account.service");
    return db.$transaction(async (tx) => {
      const updated = await this.transactionRepo.update(id, userId, data, tx);
      await AuditLogService.log(
        {
          userId,
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.TRANSACTION,
          entityId: id,
          before: {
            amount: existing.amount.toString(),
            description: existing.description,
            categoryId: existing.categoryId,
            date: existing.date.toISOString(),
            notes: existing.notes,
          },
          after: {
            amount: updated.amount.toString(),
            description: updated.description,
            categoryId: updated.categoryId,
            date: updated.date.toISOString(),
            notes: updated.notes,
          },
        },
        tx
      );

      // Recalculate balances for all accounts that were or are involved
      const affectedAccountIds = new Set<string>();
      if (existing.accountId) affectedAccountIds.add(existing.accountId);
      if (existing.toAccountId) affectedAccountIds.add(existing.toAccountId);
      if (updated.accountId) affectedAccountIds.add(updated.accountId);
      if (updated.toAccountId) affectedAccountIds.add(updated.toAccountId);

      for (const accId of affectedAccountIds) {
        await accountService.updateAccountBalance(userId, accId, tx);
      }

      return updated;
    });
  }

  /**
   * Deletes a transaction. Scoped by ID and userId.
   */
  async deleteTransaction(id: string, userId: string): Promise<Transaction> {
    const existing = await this.transactionRepo.findById(id, userId);
    if (!existing) {
      throw new Error("TRANSACTION_NOT_FOUND: The selected transaction was not found or you do not have permission to delete it.");
    }

    const { accountService } = await import("./account.service");
    return db.$transaction(async (tx) => {
      const deleted = await this.transactionRepo.delete(id, userId, tx);

      // Recalculate balances for accounts that were involved
      if (deleted.accountId) {
        await accountService.updateAccountBalance(userId, deleted.accountId, tx);
      }
      if (deleted.toAccountId) {
        await accountService.updateAccountBalance(userId, deleted.toAccountId, tx);
      }

      return deleted;
    });
  }

  /**
   * Compatibility rules updated for multi-account automation (Milestone 7.2).
   */
  validateCategoryCompatibility(txType: TransactionType, catType: CategoryType): void {
    if (txType === TransactionType.INCOME) {
      if (catType !== CategoryType.INCOME) {
        throw new Error("INVALID_CATEGORY_COMPATIBILITY: Income transactions can only use Income categories.");
      }
    } else if (txType === TransactionType.EXPENSE) {
      if (catType !== CategoryType.FIXED_EXPENSE && catType !== CategoryType.VARIABLE_EXPENSE) {
        throw new Error("INVALID_CATEGORY_COMPATIBILITY: Expense transactions can only use Fixed Expense or Variable Expense categories.");
      }
    } else if (txType === TransactionType.DEBT_PAYMENT) {
      if (catType !== CategoryType.DEBT) {
        throw new Error("INVALID_CATEGORY_COMPATIBILITY: Debt Payment transactions can only use Debt categories.");
      }
    } else if (txType === TransactionType.SAVINGS) {
      if (catType !== CategoryType.SAVINGS) {
        throw new Error("INVALID_CATEGORY_COMPATIBILITY: Savings transactions can only use Savings categories.");
      }
    } else if (txType === TransactionType.REMITTANCE) {
      if (catType !== CategoryType.REMITTANCE) {
        throw new Error("INVALID_CATEGORY_COMPATIBILITY: Remittance transactions can only use Remittance categories.");
      }
    } else if (txType === TransactionType.TRANSFER) {
      // Transfers bypass category checks (allow any category like 'Transfers' or 'Rent Cash')
      return;
    } else {
      throw new Error(`UNSUPPORTED_TRANSACTION_TYPE: Transaction type '${txType}' is not supported.`);
    }
  }
}
