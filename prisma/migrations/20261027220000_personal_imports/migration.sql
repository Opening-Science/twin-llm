-- Imported personal data (#176): a dataset per uploaded file, owned by a user,
-- never the synthetic warehouse. Rows go when their dataset is deleted (cascade).

-- CreateTable
CREATE TABLE "personal_datasets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "row_count" INTEGER NOT NULL,
    "first_at" TEXT,
    "last_at" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_observations" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_system" TEXT,
    "code" TEXT,
    "display" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_ucum" BOOLEAN NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "effective_precision" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "personal_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_clinical_records" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "code_system" TEXT,
    "code" TEXT,
    "display" TEXT NOT NULL,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "status" TEXT,
    "source_ref" TEXT NOT NULL,

    CONSTRAINT "personal_clinical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_tables" (
    "dataset_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,

    CONSTRAINT "personal_tables_pkey" PRIMARY KEY ("dataset_id")
);

-- CreateTable
CREATE TABLE "personal_table_chunks" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "rows" JSONB NOT NULL,

    CONSTRAINT "personal_table_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_datasets_user_id_created_at_idx" ON "personal_datasets"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "personal_datasets_user_id_sha256_key" ON "personal_datasets"("user_id", "sha256");

-- CreateIndex
CREATE INDEX "personal_observations_dataset_id_idx" ON "personal_observations"("dataset_id");

-- CreateIndex
CREATE INDEX "personal_observations_user_id_code_effective_at_idx" ON "personal_observations"("user_id", "code", "effective_at");

-- CreateIndex
CREATE INDEX "personal_clinical_records_dataset_id_idx" ON "personal_clinical_records"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "personal_table_chunks_dataset_id_chunk_index_key" ON "personal_table_chunks"("dataset_id", "chunk_index");

-- AddForeignKey
ALTER TABLE "personal_datasets" ADD CONSTRAINT "personal_datasets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_observations" ADD CONSTRAINT "personal_observations_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "personal_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_clinical_records" ADD CONSTRAINT "personal_clinical_records_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "personal_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_tables" ADD CONSTRAINT "personal_tables_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "personal_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_table_chunks" ADD CONSTRAINT "personal_table_chunks_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "personal_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allowed values, by hand: Prisma has no CHECK syntax.
ALTER TABLE "personal_datasets" ADD CONSTRAINT "personal_datasets_kind_check" CHECK ("kind" IN ('fhir', 'lab-csv', 'table'));
ALTER TABLE "personal_datasets" ADD CONSTRAINT "personal_datasets_status_check" CHECK ("status" IN ('ready'));
ALTER TABLE "personal_datasets" ADD CONSTRAINT "personal_datasets_row_count_check" CHECK ("row_count" >= 0);
ALTER TABLE "personal_observations" ADD CONSTRAINT "personal_observations_effective_precision_check" CHECK ("effective_precision" IN ('year', 'month', 'day', 'instant'));
ALTER TABLE "personal_clinical_records" ADD CONSTRAINT "personal_clinical_records_resource_type_check" CHECK ("resource_type" IN ('Condition', 'MedicationRequest'));
