-- AlterTable
ALTER TABLE "Account" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: each user's existing Emirates NBD account (created for everyone
-- via ensureDefaultAccounts, the de facto main account today) becomes their
-- primary. Users with no ENBD account are left with no primary set rather
-- than guessing.
UPDATE "Account" a
SET "isPrimary" = true
WHERE a."type" = 'EMIRATES_NBD'
  AND a.id = (
    SELECT a2.id FROM "Account" a2
    WHERE a2."userId" = a."userId" AND a2."type" = 'EMIRATES_NBD'
    ORDER BY a2."createdAt" ASC
    LIMIT 1
  );

-- CreateIndex: at most one primary account per user. Prisma has no native
-- "unique among true values" constraint, so this is a raw partial index.
CREATE UNIQUE INDEX "Account_userId_isPrimary_unique"
  ON "Account" ("userId") WHERE "isPrimary" = true;
