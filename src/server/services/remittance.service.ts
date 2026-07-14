import { RemittanceRepository, RemittanceFilters } from "../repositories/remittance.repository";
import { CategoryRepository } from "../repositories/category.repository";
import { TransactionRepository } from "../repositories/transaction.repository";
import { db } from "@/lib/db";
import { Decimal } from "decimal.js";
import { Remittance, RemittanceStatus, CategoryType, TransactionType, CashFlowDirection } from "@prisma/client";
import { AuditLogService } from "./audit-log.service";
import { AuditAction, AuditEntityType } from "@prisma/client";

export class RemittanceService {
  private remittanceRepo = new RemittanceRepository();
  private categoryRepo = new CategoryRepository();
  private transactionRepo = new TransactionRepository();

  async getRemittances(userId: string, filters: RemittanceFilters = {}) {
    const totalItems = await this.remittanceRepo.count(userId, filters);
    const items = await this.remittanceRepo.findMany(userId, filters);

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

  async getRemittanceById(id: string, userId: string): Promise<Remittance> {
    const remittance = await this.remittanceRepo.findById(id, userId);
    if (!remittance) {
      throw new Error("REMITTANCE_NOT_FOUND");
    }
    return remittance;
  }

  async createRemittance(
    userId: string,
    data: {
      recipient?: string | null;
      amountSentAed: number | string | Decimal;
      exchangeRate?: number | string | Decimal | null;
      transferFeeAed?: number | string | Decimal | null;
      transferProvider: string;
      transferDate: Date | string;
      referenceNumber?: string | null;
      notes?: string | null;
      categoryId?: string | null;
      syncLedger?: boolean;
      idempotencyKey?: string | null;
    }
  ): Promise<Remittance> {
    // 1. Idempotency Check
    if (data.idempotencyKey) {
      const existing = await this.remittanceRepo.findByIdempotencyKey(userId, data.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const amountSentAed = new Decimal(data.amountSentAed);
    if (amountSentAed.lessThanOrEqualTo(0)) {
      throw new Error("INVALID_AMOUNT: Amount sent must be greater than zero.");
    }

    let exchangeRate: Decimal | null = null;
    let amountReceivedPhp: Decimal | null = null;
    if (data.exchangeRate !== undefined && data.exchangeRate !== null) {
      exchangeRate = new Decimal(data.exchangeRate);
      if (exchangeRate.lessThanOrEqualTo(0)) {
        throw new Error("INVALID_EXCHANGE_RATE: Exchange rate must be greater than zero.");
      }
      amountReceivedPhp = amountSentAed.mul(exchangeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }

    let transferFeeAed: Decimal | null = null;
    if (data.transferFeeAed !== undefined && data.transferFeeAed !== null) {
      transferFeeAed = new Decimal(data.transferFeeAed);
      if (transferFeeAed.lessThan(0)) {
        throw new Error("INVALID_FEE: Transfer fee must be non-negative.");
      }
    }

    const cashOutflowAed = amountSentAed.add(transferFeeAed ?? 0);
    const txDateObj = typeof data.transferDate === "string" ? new Date(data.transferDate) : data.transferDate;

    return db.$transaction(async (tx) => {
      let linkedTransactionId: string | null = null;

      // 2. Validate category and sync to ledger
      if (data.syncLedger) {
        if (!data.categoryId) {
          throw new Error("CATEGORY_REQUIRED: A category is required to sync with the ledger.");
        }

        const category = await this.categoryRepo.findByIdAndUserId(data.categoryId, userId, tx);
        if (!category || category.type !== CategoryType.REMITTANCE) {
          throw new Error("INVALID_CATEGORY: Selected category is invalid or not of type REMITTANCE.");
        }

        // Create transaction in ledger
        const ledgerTx = await this.transactionRepo.create(
          userId,
          {
            date: txDateObj,
            categoryId: data.categoryId,
            description: `Remittance to ${data.recipient || "Recipient"} via ${data.transferProvider}`,
            amount: cashOutflowAed,
            paymentMethod: data.transferProvider,
            notes: data.notes || null,
            type: TransactionType.REMITTANCE,
            cashFlowDirection: CashFlowDirection.OUTFLOW,
          },
          tx
        );
        linkedTransactionId = ledgerTx.id;
      }

      // 3. Create Remittance
      return this.remittanceRepo.create(
        userId,
        {
          recipient: data.recipient || null,
          amountSentAed,
          cashOutflowAed,
          exchangeRate,
          amountReceivedPhp,
          transferFeeAed,
          transferProvider: data.transferProvider,
          transferDate: txDateObj,
          referenceNumber: data.referenceNumber || null,
          notes: data.notes || null,
          status: RemittanceStatus.COMPLETED,
          transactionId: linkedTransactionId,
          categoryId: data.syncLedger ? data.categoryId : null,
          idempotencyKey: data.idempotencyKey || null,
        },
        tx
      );
    });
  }

  async reverseRemittance(
    id: string,
    userId: string,
    data: {
      reversalReason: string;
      reversalIdempotencyKey?: string | null;
      expectedVersion?: number;
    }
  ): Promise<Remittance> {
    // 1. Reversal Idempotency Check
    if (data.reversalIdempotencyKey) {
      const existing = await this.remittanceRepo.findByReversalIdempotencyKey(userId, data.reversalIdempotencyKey);
      if (existing) {
        return existing;
      }
    }

    if (!data.reversalReason.trim()) {
      throw new Error("REVERSAL_REASON_REQUIRED: A reason is required to reverse a remittance.");
    }

    return db.$transaction(async (tx) => {
      // 2. Fetch original remittance
      const remittance = await this.remittanceRepo.findById(id, userId, tx);
      if (!remittance) {
        throw new Error("REMITTANCE_NOT_FOUND");
      }

      if (remittance.status === RemittanceStatus.REVERSED) {
        throw new Error("REMITTANCE_ALREADY_REVERSED: This remittance has already been reversed.");
      }

      // Check version if supplied
      const currentVersion = data.expectedVersion ?? remittance.version;

      let reversalTransactionId: string | null = null;

      // 3. If original had linked transaction, create offsetting transaction
      if (remittance.transactionId) {
        const originalTx = await this.transactionRepo.findById(remittance.transactionId, userId, tx);
        if (originalTx) {
          const offsetTx = await this.transactionRepo.create(
            userId,
            {
              date: new Date(),
              categoryId: originalTx.categoryId,
              description: `Reversal of Remittance ref: ${remittance.referenceNumber || remittance.id}`,
              amount: remittance.cashOutflowAed, // Exactly the original cash outflow amount
              paymentMethod: originalTx.paymentMethod,
              notes: `Reason: ${data.reversalReason}`,
              type: TransactionType.REMITTANCE,
              cashFlowDirection: CashFlowDirection.INFLOW, // Offsetting inflow
            },
            tx
          );
          reversalTransactionId = offsetTx.id;
        }
      }

      // 4. Update status and link reversal
      const reversed = await this.remittanceRepo.update(
        id,
        userId,
        {
          status: RemittanceStatus.REVERSED,
          reversedAt: new Date(),
          reversalReason: data.reversalReason,
          reversalTransactionId,
          reversalIdempotencyKey: data.reversalIdempotencyKey || null,
        },
        currentVersion,
        tx
      );

      // 5. Audit the reversal atomically within the same transaction
      await AuditLogService.log(
        {
          userId,
          action: AuditAction.REVERSE,
          entityType: AuditEntityType.REMITTANCE,
          entityId: id,
          before: {
            status: remittance.status,
            amountSentAed: remittance.amountSentAed.toString(),
          },
          after: {
            status: RemittanceStatus.REVERSED,
            reversedAt: reversed.reversedAt?.toISOString(),
            reversalReason: data.reversalReason,
            reversalTransactionId,
          },
        },
        tx
      );

      return reversed;
    });
  }

  async archiveRemittance(id: string, userId: string): Promise<Remittance> {
    return this.remittanceRepo.update(
      id,
      userId,
      { archivedAt: new Date() }
    );
  }

  async unarchiveRemittance(id: string, userId: string): Promise<Remittance> {
    return this.remittanceRepo.update(
      id,
      userId,
      { archivedAt: null }
    );
  }
}
