-- IHME GBD results a person imported from the GBD Results Tool (#387). Population estimates only.
-- CreateTable
CREATE TABLE "gbd_imports" (
    "sha256" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "new_rows" INTEGER NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gbd_imports_pkey" PRIMARY KEY ("sha256")
);

-- CreateTable
CREATE TABLE "gbd_estimates" (
    "key" TEXT NOT NULL,
    "import_sha" TEXT NOT NULL,
    "measure_id" INTEGER NOT NULL,
    "measure_name" TEXT NOT NULL,
    "location_id" INTEGER NOT NULL,
    "location_name" TEXT NOT NULL,
    "sex_id" INTEGER NOT NULL,
    "sex_name" TEXT NOT NULL,
    "age_id" INTEGER NOT NULL,
    "age_name" TEXT NOT NULL,
    "cause_id" INTEGER,
    "cause_name" TEXT,
    "rei_id" INTEGER,
    "rei_name" TEXT,
    "metric_id" INTEGER NOT NULL,
    "metric_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "val" DOUBLE PRECISION NOT NULL,
    "upper" DOUBLE PRECISION,
    "lower" DOUBLE PRECISION,

    CONSTRAINT "gbd_estimates_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "gbd_estimates_measure_id_metric_id_sex_id_age_id_year_idx" ON "gbd_estimates"("measure_id", "metric_id", "sex_id", "age_id", "year");

-- CreateIndex
CREATE INDEX "gbd_estimates_location_id_idx" ON "gbd_estimates"("location_id");

-- AddForeignKey
ALTER TABLE "gbd_estimates" ADD CONSTRAINT "gbd_estimates_import_sha_fkey" FOREIGN KEY ("import_sha") REFERENCES "gbd_imports"("sha256") ON DELETE CASCADE ON UPDATE CASCADE;

