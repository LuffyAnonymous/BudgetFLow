-- Safe removal of MASHREQ from AccountType
-- 1. Safely remove any legacy Account rows referencing MASHREQ before altering enum
DELETE FROM "Account" WHERE "type"::text = 'MASHREQ';

-- 2. Create new enum type without MASHREQ
CREATE TYPE "AccountType_new" AS ENUM ('EMIRATES_NBD', 'CASH');

-- 3. Alter Account table to use AccountType_new
ALTER TABLE "Account" ALTER COLUMN "type" TYPE "AccountType_new" USING ("type"::text::"AccountType_new");

-- 4. Drop old AccountType enum
DROP TYPE "AccountType";

-- 5. Rename AccountType_new to AccountType
ALTER TYPE "AccountType_new" RENAME TO "AccountType";

-- AlterTable Transaction: Add budgetMonth
ALTER TABLE "Transaction" ADD COLUMN "budgetMonth" TEXT;

-- AlterTable ImportedTransaction: Add budgetMonth
ALTER TABLE "ImportedTransaction" ADD COLUMN "budgetMonth" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_userId_budgetMonth_idx" ON "Transaction"("userId", "budgetMonth");
