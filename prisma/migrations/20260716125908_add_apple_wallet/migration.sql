-- AlterEnum
ALTER TYPE "ImportSource" ADD VALUE 'APPLE_WALLET';

-- AlterEnum
ALTER TYPE "TransactionOrigin" ADD VALUE 'APPLE_WALLET';

-- DropIndex
DROP INDEX "ImportedTransaction_transactionId_key";
