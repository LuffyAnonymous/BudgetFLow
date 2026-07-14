-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecurringOccurrenceStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecurringSourceType" AS ENUM ('DEBT', 'SAVING_GOAL', 'REMITTANCE_PLAN', 'GENERAL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('UPCOMING_PAYMENT', 'PAYMENT_DUE_TODAY', 'OVERDUE_PAYMENT', 'BUDGET_NEAR_LIMIT', 'BUDGET_EXCEEDED', 'SAVINGS_GOAL_REACHED', 'DEBT_PAID_OFF', 'RECURRING_ENTRY_CREATED', 'ROLLOVER_AVAILABLE');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- DropIndex
DROP INDEX "Setting_userId_idx";

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "defaultPageSize" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "foodGroupKey" TEXT NOT NULL DEFAULT 'FOOD',
ADD COLUMN     "reminderLeadDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "rolloverPref" JSONB,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RecurringTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "dueDay" INTEGER,
    "autoCreate" BOOLEAN NOT NULL DEFAULT false,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "RecurringSourceType" NOT NULL DEFAULT 'GENERAL',
    "sourceEntityId" TEXT,
    "categoryId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringOccurrence" (
    "id" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "status" "RecurringOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "handledAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "recurringTemplateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "linkedTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "eventKey" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "destinationPath" TEXT,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyRollover" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceMonth" TEXT NOT NULL,
    "targetMonth" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "copiedBudgetCount" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyRollover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringTemplate_userId_status_idx" ON "RecurringTemplate"("userId", "status");

-- CreateIndex
CREATE INDEX "RecurringTemplate_categoryId_idx" ON "RecurringTemplate"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_linkedTransactionId_key" ON "RecurringOccurrence"("linkedTransactionId");

-- CreateIndex
CREATE INDEX "RecurringOccurrence_userId_status_scheduledDate_idx" ON "RecurringOccurrence"("userId", "status", "scheduledDate");

-- CreateIndex
CREATE INDEX "RecurringOccurrence_recurringTemplateId_idx" ON "RecurringOccurrence"("recurringTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_userId_idempotencyKey_key" ON "RecurringOccurrence"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_userId_recurringTemplateId_scheduledDat_key" ON "RecurringOccurrence"("userId", "recurringTemplateId", "scheduledDate");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_dismissedAt_idx" ON "Notification"("userId", "readAt", "dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");

-- CreateIndex
CREATE INDEX "MonthlyRollover_userId_idx" ON "MonthlyRollover"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRollover_userId_targetMonth_key" ON "MonthlyRollover"("userId", "targetMonth");

-- AddForeignKey
ALTER TABLE "RecurringTemplate" ADD CONSTRAINT "RecurringTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTemplate" ADD CONSTRAINT "RecurringTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "RecurringTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_linkedTransactionId_fkey" FOREIGN KEY ("linkedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyRollover" ADD CONSTRAINT "MonthlyRollover_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
