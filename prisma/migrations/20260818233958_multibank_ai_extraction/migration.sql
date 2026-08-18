-- AlterEnum
-- Add UAE bank / BNPL / wallet institution types, plus a catch-all for anything
-- not explicitly listed. Verified: no production Account rows depend on this
-- being a closed set.
ALTER TYPE "AccountType" ADD VALUE 'ADCB';
ALTER TYPE "AccountType" ADD VALUE 'FAB';
ALTER TYPE "AccountType" ADD VALUE 'MASHREQ';
ALTER TYPE "AccountType" ADD VALUE 'RAKBANK';
ALTER TYPE "AccountType" ADD VALUE 'DIB';
ALTER TYPE "AccountType" ADD VALUE 'CBD';
ALTER TYPE "AccountType" ADD VALUE 'ADIB';
ALTER TYPE "AccountType" ADD VALUE 'HSBC_UAE';
ALTER TYPE "AccountType" ADD VALUE 'SIB';
ALTER TYPE "AccountType" ADD VALUE 'WIO';
ALTER TYPE "AccountType" ADD VALUE 'LIV';
ALTER TYPE "AccountType" ADD VALUE 'TABBY';
ALTER TYPE "AccountType" ADD VALUE 'TAMARA';
ALTER TYPE "AccountType" ADD VALUE 'BOTIM';
ALTER TYPE "AccountType" ADD VALUE 'OTHER_BANK';

-- AlterEnum
-- Rename PDF -> DOCUMENT (covers photographed receipts, scans, and PDF
-- invoices). Verified via production query: zero ImportedTransaction or
-- Transaction rows currently use ImportSource.PDF, so this rename is safe.
BEGIN;
CREATE TYPE "ImportSource_new" AS ENUM ('SMS', 'CSV', 'EMAIL', 'DOCUMENT', 'OPEN_BANKING', 'APPLE_WALLET');
ALTER TABLE "Transaction" ALTER COLUMN "importSource" TYPE "ImportSource_new" USING ("importSource"::text::"ImportSource_new");
ALTER TABLE "ImportedTransaction" ALTER COLUMN "source" TYPE "ImportSource_new" USING ("source"::text::"ImportSource_new");
ALTER TYPE "ImportSource" RENAME TO "ImportSource_old";
ALTER TYPE "ImportSource_new" RENAME TO "ImportSource";
DROP TYPE "public"."ImportSource_old";
COMMIT;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "importedTransactionId" TEXT;

-- AlterTable
ALTER TABLE "ImportedTransaction" ADD COLUMN     "extractionMethod" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_importedTransactionId_idx" ON "Attachment"("importedTransactionId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_importedTransactionId_fkey" FOREIGN KEY ("importedTransactionId") REFERENCES "ImportedTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
