-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ImportStatus" ADD VALUE 'IGNORED';
ALTER TYPE "ImportStatus" ADD VALUE 'PENDING_EVENT';

-- AlterTable
ALTER TABLE "ImportedTransaction" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "rawPayload" TEXT,
ADD COLUMN     "serverReceivedAt" TIMESTAMP(3);
