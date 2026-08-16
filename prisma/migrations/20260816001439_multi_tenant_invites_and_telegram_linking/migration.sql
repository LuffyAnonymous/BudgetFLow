-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_REGISTERED';
ALTER TYPE "AuditAction" ADD VALUE 'TELEGRAM_LINKED';

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'INVITE_CODE';

-- AlterTable
ALTER TABLE "ImportSetting" ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramLinkCode" TEXT,
ADD COLUMN     "telegramLinkCodeExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_usedByUserId_key" ON "InviteCode"("usedByUserId");

-- CreateIndex
CREATE INDEX "InviteCode_code_idx" ON "InviteCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSetting_telegramChatId_key" ON "ImportSetting"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportSetting_telegramLinkCode_key" ON "ImportSetting"("telegramLinkCode");

-- AddForeignKey
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
