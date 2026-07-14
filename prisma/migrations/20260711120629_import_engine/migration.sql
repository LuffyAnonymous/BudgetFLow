-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('SMS', 'CSV', 'EMAIL', 'PDF', 'OPEN_BANKING');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('RECEIVED', 'REVIEW_REQUIRED', 'PROCESSING', 'PROCESSED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SMS_IMPORT_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE 'SMS_IMPORT_DUPLICATE';
ALTER TYPE "AuditAction" ADD VALUE 'SMS_IMPORT_PROCESSED';
ALTER TYPE "AuditAction" ADD VALUE 'SMS_IMPORT_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'SMS_IMPORT_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_TOKEN_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_TOKEN_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_REJECTED_MANUAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'IMPORTED_TRANSACTION';
ALTER TYPE "AuditEntityType" ADD VALUE 'IMPORT_SETTING';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "adjustedAt" TIMESTAMP(3),
ADD COLUMN     "importSource" "ImportSource";

-- CreateTable
CREATE TABLE "ImportSetting" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoImportSalary" BOOLEAN NOT NULL DEFAULT false,
    "senderAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salaryCategoryId" TEXT,
    "expectedCurrency" TEXT NOT NULL DEFAULT 'AED',
    "minimumAmount" DECIMAL(12,2),
    "maximumAmount" DECIMAL(12,2),
    "rawPayloadRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "tokenHash" TEXT,
    "tokenCreatedAt" TIMESTAMP(3),
    "tokenRevokedAt" TIMESTAMP(3),
    "lastSuccessfulImportAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedTransaction" (
    "id" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "institution" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'RECEIVED',
    "confidence" "ImportConfidence",
    "parserKey" TEXT,
    "parserVersion" TEXT,
    "redactedPayload" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "maskedSender" TEXT,
    "parsedAmount" DECIMAL(12,2),
    "parsedCurrency" TEXT,
    "parsedReference" TEXT,
    "parsedDescription" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "financialDate" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "fingerprint" TEXT NOT NULL,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "lastDuplicateAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "transactionId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportSetting_userId_key" ON "ImportSetting"("userId");

-- CreateIndex
CREATE INDEX "ImportSetting_tokenHash_idx" ON "ImportSetting"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTransaction_transactionId_key" ON "ImportedTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "ImportedTransaction_userId_status_createdAt_idx" ON "ImportedTransaction"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportedTransaction_userId_source_createdAt_idx" ON "ImportedTransaction"("userId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "ImportedTransaction_userId_receivedAt_idx" ON "ImportedTransaction"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "ImportedTransaction_userId_fingerprint_idx" ON "ImportedTransaction"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTransaction_userId_fingerprint_key" ON "ImportedTransaction"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTransaction_userId_idempotencyKey_key" ON "ImportedTransaction"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "ImportSetting" ADD CONSTRAINT "ImportSetting_salaryCategoryId_fkey" FOREIGN KEY ("salaryCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportSetting" ADD CONSTRAINT "ImportSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedTransaction" ADD CONSTRAINT "ImportedTransaction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedTransaction" ADD CONSTRAINT "ImportedTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
