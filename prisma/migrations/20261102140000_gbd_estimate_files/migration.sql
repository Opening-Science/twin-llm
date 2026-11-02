-- Which imported GBD files have each estimate (#428), so deleting one file keeps
-- the estimates another file also has. Population estimates only.
-- CreateTable
CREATE TABLE "gbd_estimate_files" (
    "import_sha" TEXT NOT NULL,
    "estimate_key" TEXT NOT NULL,

    CONSTRAINT "gbd_estimate_files_pkey" PRIMARY KEY ("import_sha","estimate_key")
);

-- Backfill: each stored estimate links to the import that brought it. Which later
-- files also had it was never recorded; importing such a file again restores that.
INSERT INTO "gbd_estimate_files" ("import_sha", "estimate_key")
SELECT "import_sha", "key" FROM "gbd_estimates";

-- CreateIndex
CREATE INDEX "gbd_estimate_files_estimate_key_idx" ON "gbd_estimate_files"("estimate_key");

-- AddForeignKey
ALTER TABLE "gbd_estimate_files" ADD CONSTRAINT "gbd_estimate_files_import_sha_fkey" FOREIGN KEY ("import_sha") REFERENCES "gbd_imports"("sha256") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gbd_estimate_files" ADD CONSTRAINT "gbd_estimate_files_estimate_key_fkey" FOREIGN KEY ("estimate_key") REFERENCES "gbd_estimates"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "gbd_estimates" DROP CONSTRAINT "gbd_estimates_import_sha_fkey";

-- AlterTable
ALTER TABLE "gbd_estimates" DROP COLUMN "import_sha";
