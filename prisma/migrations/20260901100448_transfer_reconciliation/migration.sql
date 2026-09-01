-- CreateEnum
CREATE TYPE "TransferMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'MERGED');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "mergedIntoTransactionId" TEXT,
ADD COLUMN     "transferMatchStatus" "TransferMatchStatus" NOT NULL DEFAULT 'UNMATCHED';

-- CreateIndex
CREATE INDEX "Transaction_userId_transferMatchStatus_date_idx" ON "Transaction"("userId", "transferMatchStatus", "date");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_mergedIntoTransactionId_fkey" FOREIGN KEY ("mergedIntoTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

