import { z } from "zod";

export const createRemittanceSchema = z.object({
  recipient: z.string().min(1, "Recipient name is required").max(100),
  amountSentAed: z.coerce.number().positive("Amount sent must be greater than zero"),
  exchangeRate: z.coerce.number().positive("Exchange rate must be greater than zero"),
  transferFeeAed: z.coerce.number().nonnegative("Transfer fee cannot be negative"),
  transferProvider: z.string().min(1, "Transfer provider is required").max(100),
  transferDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid transfer date format",
  }),
  referenceNumber: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  syncLedger: z.boolean().optional(),
  idempotencyKey: z.string().uuid().nullable().optional(),
});

export const reverseRemittanceSchema = z.object({
  reversalReason: z.string().min(1, "Reversal reason is required").max(500),
  reversalIdempotencyKey: z.string().uuid().nullable().optional(),
  expectedVersion: z.coerce.number().int().nonnegative().optional(),
});
