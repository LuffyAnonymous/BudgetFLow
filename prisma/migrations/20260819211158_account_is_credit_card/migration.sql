-- Distinguishes a credit card account (a liability whose balance represents
-- what's owed, not spendable cash) from a regular bank/wallet account.
ALTER TABLE "Account" ADD COLUMN "isCreditCard" BOOLEAN NOT NULL DEFAULT false;
