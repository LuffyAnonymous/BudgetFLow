import { z } from "zod";

export const createDebtSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  originalBalance: z.coerce.number().positive("Original balance must be greater than zero"),
  monthlyPayment: z.coerce.number().positive("Monthly payment must be greater than zero"),
  dueDay: z.coerce.number().int().min(1, "Due day must be between 1 and 31").max(31, "Due day must be between 1 and 31"),
  rolloverFeeRate: z.coerce.number().nonnegative("Rollover fee rate cannot be negative"),
  categoryId: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  payeeAliases: z.array(z.string().min(1).max(100)).max(20).optional(),
});

export const updateDebtSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  monthlyPayment: z.coerce.number().positive("Monthly payment must be greater than zero").optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
  rolloverFeeRate: z.coerce.number().nonnegative().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(["ACTIVE", "PAID", "ARCHIVED", "PAUSED"]).optional(),
  notes: z.string().max(500).nullable().optional(),
  payeeAliases: z.array(z.string().min(1).max(100)).max(20).optional(),
});

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive("Payment amount must be greater than zero"),
  paymentDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid payment date format",
  }),
  notes: z.string().max(500).nullable().optional(),
  idempotencyKey: z.string().uuid().nullable().optional(),
  syncLedger: z.boolean().optional(),
});
