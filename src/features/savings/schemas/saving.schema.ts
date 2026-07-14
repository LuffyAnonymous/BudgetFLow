import { z } from "zod";

export const createSavingGoalSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  targetAmount: z.coerce.number().positive("Target amount must be greater than zero"),
  targetDate: z.string().refine((val) => !val || !isNaN(Date.parse(val)), {
    message: "Invalid target date format",
  }).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const updateSavingGoalSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  targetAmount: z.coerce.number().positive("Target amount must be greater than zero").optional(),
  targetDate: z.string().refine((val) => !val || !isNaN(Date.parse(val)), {
    message: "Invalid target date format",
  }).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED", "PAUSED"]).optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const recordSavingTransactionSchema = z.object({
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  type: z.enum(["DEPOSIT", "WITHDRAWAL"]),
  transactionDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid transaction date format",
  }),
  notes: z.string().max(500).nullable().optional(),
  idempotencyKey: z.string().uuid().nullable().optional(),
  syncLedger: z.boolean().optional(),
});
