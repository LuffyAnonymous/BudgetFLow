-- Drop `autoImportSalary`: never read anywhere in the import pipeline (SMS
-- auto-post is already unconditional on confidence score), so the column
-- and its precondition-gated toggle were dead weight.
ALTER TABLE "ImportSetting" DROP COLUMN "autoImportSalary";
