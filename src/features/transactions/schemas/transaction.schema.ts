import { z } from "zod";
import { Decimal } from "decimal.js";
import { TransactionType } from "@prisma/client";

export const transactionFormSchema = z.object({
  date: z.preprocess(
    (val) => (typeof val === "string" ? new Date(val) : val),
    z.date()
  ),
  categoryId: z.string().uuid("Invalid category ID format."),
  description: z
    .string()
    .trim()
    .min(1, "Description is required.")
    .max(100, "Description cannot exceed 100 characters."),
  amount: z
    .string()
    .min(1, "Amount is required.")
    .refine(
      (val) => {
        try {
          const dec = new Decimal(val);
          return dec.gt(0);
        } catch {
          return false;
        }
      },
      { message: "Amount must be greater than zero." }
    ),
  paymentMethod: z
    .string()
    .trim()
    .min(1, "Payment method is required.")
    .max(50, "Payment method cannot exceed 50 characters."),
  notes: z
    .string()
    .trim()
    .max(200, "Notes cannot exceed 200 characters.")
    .nullish(),
  type: z.nativeEnum(TransactionType),
  accountId: z.string().uuid().nullable().optional(),
  toAccountId: z.string().uuid().nullable().optional(),
});
