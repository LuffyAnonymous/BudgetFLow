-- Names a debt is paid to, matched against imported transaction
-- descriptions to auto-apply payments without a manual "Record Payment" click.
ALTER TABLE "Debt" ADD COLUMN "payeeAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
