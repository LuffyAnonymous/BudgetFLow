-- AlterTable: First add cashOutflowAed as nullable
ALTER TABLE "Remittance" ADD COLUMN "cashOutflowAed" DECIMAL(12,2);

-- Populate cashOutflowAed for existing records
UPDATE "Remittance" SET "cashOutflowAed" = "amountSentAed" + COALESCE("transferFeeAed", 0);

-- Make cashOutflowAed NOT NULL
ALTER TABLE "Remittance" ALTER COLUMN "cashOutflowAed" SET NOT NULL;

-- Alter remaining columns to drop NOT NULL constraints
ALTER TABLE "Remittance" 
ALTER COLUMN "recipient" DROP NOT NULL,
ALTER COLUMN "exchangeRate" DROP NOT NULL,
ALTER COLUMN "amountReceivedPhp" DROP NOT NULL,
ALTER COLUMN "transferFeeAed" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Account_userId_type_idx" ON "Account"("userId", "type");

-- CreateIndex
CREATE INDEX "Transaction_userId_accountId_date_idx" ON "Transaction"("userId", "accountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_userId_toAccountId_date_idx" ON "Transaction"("userId", "toAccountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_userId_type_date_idx" ON "Transaction"("userId", "type", "date");
