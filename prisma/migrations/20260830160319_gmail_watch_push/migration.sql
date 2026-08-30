-- AlterTable
ALTER TABLE "GmailIntegration" DROP COLUMN "lastPolledAt",
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "watchExpiration" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GmailIntegration_watchExpiration_idx" ON "GmailIntegration"("watchExpiration");
