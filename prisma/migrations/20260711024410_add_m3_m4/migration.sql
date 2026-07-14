/*
  Warnings:

  - You are about to drop the column `dueDate` on the `Debt` table. All the data in the column will be lost.
  - You are about to drop the column `rolloverFee` on the `Debt` table. All the data in the column will be lost.
  - You are about to drop the column `date` on the `DebtPayment` table. All the data in the column will be lost.
  - You are about to drop the column `amountAed` on the `Remittance` table. All the data in the column will be lost.
  - You are about to drop the column `amountPhp` on the `Remittance` table. All the data in the column will be lost.
  - You are about to drop the column `date` on the `Remittance` table. All the data in the column will be lost.
  - You are about to drop the column `transferFee` on the `Remittance` table. All the data in the column will be lost.
  - You are about to drop the column `transferMethod` on the `Remittance` table. All the data in the column will be lost.
  - You are about to drop the column `date` on the `SavingTransaction` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,idempotencyKey]` on the table `DebtPayment` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[reversalTransactionId]` on the table `Remittance` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,idempotencyKey]` on the table `Remittance` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,reversalIdempotencyKey]` on the table `Remittance` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,idempotencyKey]` on the table `SavingTransaction` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `dueDay` to the `Debt` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rolloverFeeRate` to the `Debt` table without a default value. This is not possible if the table is not empty.
  - Added the required column `balanceAfter` to the `DebtPayment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `balanceBefore` to the `DebtPayment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentDate` to the `DebtPayment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountReceivedPhp` to the `Remittance` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amountSentAed` to the `Remittance` table without a default value. This is not possible if the table is not empty.
  - Added the required column `transferDate` to the `Remittance` table without a default value. This is not possible if the table is not empty.
  - Added the required column `transferFeeAed` to the `Remittance` table without a default value. This is not possible if the table is not empty.
  - Added the required column `transferProvider` to the `Remittance` table without a default value. This is not possible if the table is not empty.
  - Added the required column `balanceAfter` to the `SavingTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `balanceBefore` to the `SavingTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `transactionDate` to the `SavingTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('ACTIVE', 'PAID', 'ARCHIVED', 'PAUSED');

-- CreateEnum
CREATE TYPE "SavingGoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED', 'PAUSED');

-- CreateEnum
CREATE TYPE "CashFlowDirection" AS ENUM ('OUTFLOW', 'INFLOW');

-- CreateEnum
CREATE TYPE "RemittanceStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'REMITTANCE';

-- DropForeignKey
ALTER TABLE "DebtPayment" DROP CONSTRAINT "DebtPayment_debtId_fkey";

-- DropForeignKey
ALTER TABLE "SavingTransaction" DROP CONSTRAINT "SavingTransaction_savingGoalId_fkey";

-- DropIndex
DROP INDEX "Debt_userId_idx";

-- DropIndex
DROP INDEX "DebtPayment_debtId_idx";

-- DropIndex
DROP INDEX "DebtPayment_userId_idx";

-- DropIndex
DROP INDEX "Remittance_userId_idx";

-- DropIndex
DROP INDEX "SavingGoal_userId_idx";

-- DropIndex
DROP INDEX "SavingTransaction_savingGoalId_idx";

-- DropIndex
DROP INDEX "SavingTransaction_userId_idx";

-- AlterTable
ALTER TABLE "Debt" DROP COLUMN "dueDate",
DROP COLUMN "rolloverFee",
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "dueDay" INTEGER NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "rolloverFeeRate" DECIMAL(7,4) NOT NULL,
ADD COLUMN     "status" "DebtStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DebtPayment" DROP COLUMN "date",
ADD COLUMN     "balanceAfter" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "balanceBefore" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paymentDate" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Remittance" DROP COLUMN "amountAed",
DROP COLUMN "amountPhp",
DROP COLUMN "date",
DROP COLUMN "transferFee",
DROP COLUMN "transferMethod",
ADD COLUMN     "amountReceivedPhp" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "amountSentAed" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "referenceNumber" TEXT,
ADD COLUMN     "reversalIdempotencyKey" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversalTransactionId" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "status" "RemittanceStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "transferDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "transferFeeAed" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "transferProvider" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "exchangeRate" SET DATA TYPE DECIMAL(18,6);

-- AlterTable
ALTER TABLE "SavingGoal" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" "SavingGoalStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "targetDate" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SavingTransaction" DROP COLUMN "date",
ADD COLUMN     "balanceAfter" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "balanceBefore" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "transactionDate" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "cashFlowDirection" "CashFlowDirection";

-- CreateIndex
CREATE INDEX "Debt_userId_status_idx" ON "Debt"("userId", "status");

-- CreateIndex
CREATE INDEX "Debt_userId_dueDay_idx" ON "Debt"("userId", "dueDay");

-- CreateIndex
CREATE INDEX "Debt_categoryId_idx" ON "Debt"("categoryId");

-- CreateIndex
CREATE INDEX "DebtPayment_userId_debtId_paymentDate_idx" ON "DebtPayment"("userId", "debtId", "paymentDate");

-- CreateIndex
CREATE INDEX "DebtPayment_userId_paymentDate_idx" ON "DebtPayment"("userId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "DebtPayment_userId_idempotencyKey_key" ON "DebtPayment"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Remittance_reversalTransactionId_key" ON "Remittance"("reversalTransactionId");

-- CreateIndex
CREATE INDEX "Remittance_userId_status_transferDate_idx" ON "Remittance"("userId", "status", "transferDate");

-- CreateIndex
CREATE INDEX "Remittance_userId_transferDate_idx" ON "Remittance"("userId", "transferDate");

-- CreateIndex
CREATE INDEX "Remittance_userId_transferProvider_idx" ON "Remittance"("userId", "transferProvider");

-- CreateIndex
CREATE INDEX "Remittance_userId_recipient_idx" ON "Remittance"("userId", "recipient");

-- CreateIndex
CREATE INDEX "Remittance_categoryId_idx" ON "Remittance"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Remittance_userId_idempotencyKey_key" ON "Remittance"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Remittance_userId_reversalIdempotencyKey_key" ON "Remittance"("userId", "reversalIdempotencyKey");

-- CreateIndex
CREATE INDEX "SavingGoal_userId_status_idx" ON "SavingGoal"("userId", "status");

-- CreateIndex
CREATE INDEX "SavingGoal_userId_targetDate_idx" ON "SavingGoal"("userId", "targetDate");

-- CreateIndex
CREATE INDEX "SavingGoal_categoryId_idx" ON "SavingGoal"("categoryId");

-- CreateIndex
CREATE INDEX "SavingTransaction_userId_savingGoalId_transactionDate_idx" ON "SavingTransaction"("userId", "savingGoalId", "transactionDate");

-- CreateIndex
CREATE INDEX "SavingTransaction_userId_transactionDate_idx" ON "SavingTransaction"("userId", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "SavingTransaction_userId_idempotencyKey_key" ON "SavingTransaction"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingGoal" ADD CONSTRAINT "SavingGoal_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingTransaction" ADD CONSTRAINT "SavingTransaction_savingGoalId_fkey" FOREIGN KEY ("savingGoalId") REFERENCES "SavingGoal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remittance" ADD CONSTRAINT "Remittance_reversalTransactionId_fkey" FOREIGN KEY ("reversalTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remittance" ADD CONSTRAINT "Remittance_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
