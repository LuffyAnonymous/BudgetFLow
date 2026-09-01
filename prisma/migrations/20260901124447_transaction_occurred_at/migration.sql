-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "occurredAt" TIMESTAMP(3);

-- Backfill: existing rows have no better answer than their own midnight-
-- truncated `date` (the best available approximation) -- leaving this null
-- would push every pre-existing transaction to the bottom (or top,
-- depending on NULLS ordering) of a list newly sorted by occurredAt.
UPDATE "Transaction" SET "occurredAt" = "date" WHERE "occurredAt" IS NULL;

-- CreateIndex
CREATE INDEX "Transaction_userId_occurredAt_idx" ON "Transaction"("userId", "occurredAt");
