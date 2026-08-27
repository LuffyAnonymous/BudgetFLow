-- AlterTable
ALTER TABLE "ImportSetting" DROP COLUMN "autoImportSalary",
DROP COLUMN "maximumAmount",
DROP COLUMN "minimumAmount";

-- AlterTable
ALTER TABLE "ImportedTransaction" ADD COLUMN     "directionAmbiguous" BOOLEAN NOT NULL DEFAULT false;
