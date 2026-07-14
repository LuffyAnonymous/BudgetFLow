-- Migration: attachment_single_parent_constraint
-- Adds a database-level check constraint ensuring every Attachment row
-- has EXACTLY ONE parent record assigned (transactionId, debtPaymentId,
-- savingTxId, or remittanceId). Zero parents or multiple parents are rejected.
--
-- This constraint complements the service-level validation in AttachmentService
-- and protects against:
--   1. Programming mistakes that bypass service validation
--   2. Direct database writes that bypass application logic
--   3. Bugs in future migration scripts that might corrupt parent links
--
-- Constraint name: attachment_single_parent
-- Safe to re-run: constraint is dropped before being added to support idempotent re-runs

ALTER TABLE "Attachment"
DROP CONSTRAINT IF EXISTS "attachment_single_parent";

ALTER TABLE "Attachment"
ADD CONSTRAINT "attachment_single_parent" CHECK (
  (
    (CASE WHEN "transactionId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "debtPaymentId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "savingTxId"    IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "remittanceId"  IS NOT NULL THEN 1 ELSE 0 END)
  ) = 1
);