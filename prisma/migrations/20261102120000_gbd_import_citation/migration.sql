-- IHME's citation from a GBD download's citation.txt (#417); null when none came with the file.
-- AlterTable
ALTER TABLE "gbd_imports" ADD COLUMN "citation" TEXT;
