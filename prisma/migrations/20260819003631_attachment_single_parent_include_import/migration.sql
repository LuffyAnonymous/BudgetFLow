-- Migration: attachment_single_parent_include_import
-- The attachment_single_parent check constraint (added in
-- 20260711035017_attachment_single_parent_constraint) predates the new
-- importedTransactionId column and only counted the original 4 parent FKs,
-- so an Attachment linked solely to an ImportedTransaction (receipt/invoice
-- uploads pending review) fails the "exactly one parent" check with sum=0.
-- Recreate the constraint to include the 5th parent column.

ALTER TABLE "Attachment"
DROP CONSTRAINT IF EXISTS "attachment_single_parent";

ALTER TABLE "Attachment"
ADD CONSTRAINT "attachment_single_parent" CHECK (
  (
    (CASE WHEN "transactionId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "debtPaymentId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "savingTxId"    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "remittanceId"  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "importedTransactionId" IS NOT NULL THEN 1 ELSE 0 END)
  ) = 1
);
