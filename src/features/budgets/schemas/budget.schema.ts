import { z } from "zod";
import { Decimal } from "decimal.js";
import { parseCanonicalMonth } from "@/lib/dates";

export const budgetFormSchema = z.object({
  categoryId: z.string().uuid("Invalid category ID format."),
  amount: z
    .string()
    .min(1, "Amount is required.")
    .refine(
      (val) => {
        try {
          const dec = new Decimal(val);
          return dec.gte(0);
        } catch {
          return false;
        }
      },
      { message: "Amount must be zero or greater." }
    ),
  month: z.string().refine(
    (val) => {
      try {
        parseCanonicalMonth(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Month must be in YYYY-MM format (e.g. 2026-07) and must be a valid calendar month." }
  ),
});
