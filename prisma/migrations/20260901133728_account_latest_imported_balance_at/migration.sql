-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "latestImportedBalanceAt" TIMESTAMP(3);

-- Backfill: an account that already has a bank-reported latestImportedBalance
-- needs an anchor time or the very next ledger recompute would treat it as
-- unanchored and re-sum the entire transaction history on top of it
-- (double-counting everything already reflected in that balance).
-- lastSMSImportedAt (processing time) is the best available approximation
-- for existing data -- it's exactly what this anchor already relied on
-- before this migration, so this preserves current behavior rather than
-- retroactively re-deriving anything.
UPDATE "Account" SET "latestImportedBalanceAt" = "lastSMSImportedAt" WHERE "latestImportedBalance" IS NOT NULL;
