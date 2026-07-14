-- Milestone 7.1: Import Setting token hardening and ImportedTransaction payload retention
-- 
-- Changes:
--   ImportSetting:
--     - Drop @@index([tokenHash]) → Add @unique tokenHash
--     - Add tokenExpiresAt DateTime?
--     - Add tokenLastUsedAt DateTime?
--   ImportedTransaction:
--     - redactedPayload: NOT NULL → NULL (retention cleanup sets to null)
--     - Add payloadClearedAt DateTime?

-- Drop the old non-unique index on tokenHash
DROP INDEX IF EXISTS "ImportSetting_tokenHash_idx";

-- Add unique constraint on tokenHash (one hash per row, prevents hash collisions across users)
ALTER TABLE "ImportSetting"
  ADD COLUMN IF NOT EXISTS "tokenExpiresAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tokenLastUsedAt" TIMESTAMP(3);

-- tokenHash unique constraint (safe: all existing values are NULL)
ALTER TABLE "ImportSetting" DROP CONSTRAINT IF EXISTS "ImportSetting_tokenHash_key";
ALTER TABLE "ImportSetting" ADD CONSTRAINT "ImportSetting_tokenHash_key" UNIQUE ("tokenHash");

-- Make redactedPayload nullable for retention cleanup
ALTER TABLE "ImportedTransaction"
  ALTER COLUMN "redactedPayload" DROP NOT NULL;

-- Add payloadClearedAt for tracking when payload was cleared
ALTER TABLE "ImportedTransaction"
  ADD COLUMN IF NOT EXISTS "payloadClearedAt" TIMESTAMP(3);
