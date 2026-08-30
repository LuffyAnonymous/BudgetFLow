-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EMAIL_IMPORT_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'GMAIL_CONNECTED';
ALTER TYPE "AuditAction" ADD VALUE 'GMAIL_DISCONNECTED';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'GMAIL_CONNECTION';

-- AlterTable
ALTER TABLE "ImportedTransaction" ADD COLUMN     "externalMessageId" TEXT,
ADD COLUMN     "institutionCode" TEXT;

-- CreateTable
CREATE TABLE "GmailIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleAccountEmail" TEXT,
    "encryptedRefreshToken" TEXT NOT NULL,
    "encryptionIv" TEXT NOT NULL,
    "encryptionAuthTag" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/gmail.readonly',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastHistoryId" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailIntegration_userId_key" ON "GmailIntegration"("userId");

-- CreateIndex
CREATE INDEX "GmailIntegration_status_idx" ON "GmailIntegration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTransaction_externalMessageId_key" ON "ImportedTransaction"("externalMessageId");

-- AddForeignKey
ALTER TABLE "GmailIntegration" ADD CONSTRAINT "GmailIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
