-- AlterTable
-- autoImportSalary was already dropped by 20260821214459_drop_auto_import_salary
ALTER TABLE "ImportSetting" DROP COLUMN "maximumAmount",
DROP COLUMN "minimumAmount";

-- AlterTable
ALTER TABLE "ImportedTransaction" ADD COLUMN     "directionAmbiguous" BOOLEAN NOT NULL DEFAULT false;
