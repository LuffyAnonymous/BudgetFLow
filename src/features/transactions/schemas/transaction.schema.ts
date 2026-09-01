import { z } from "zod";
import { Decimal } from "decimal.js";
import { TransactionType } from "@prisma/client";

export const transactionFormSchema = z.object({
  date: z.preprocess(
    (val) => (typeof val === "string" ? new Date(val) : val),
    z.date()
  ),
  budgetMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Invalid budget month format (YYYY-MM).")
    .nullable()
    .optional(),
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
  // Derived server-side from the selected account (see
  // TransactionService.createTransaction) — the form no longer collects
  // this as free text, so it's optional here rather than required.
  paymentMethod: z
    .string()
    .trim()
    .max(50, "Payment method cannot exceed 50 characters.")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(200, "Notes cannot exceed 200 characters.")
    .nullish(),
  type: z.nativeEnum(TransactionType),
  accountId: z.string().uuid("Please select an account."),
  toAccountId: z.string().uuid().nullable().optional(),
});
