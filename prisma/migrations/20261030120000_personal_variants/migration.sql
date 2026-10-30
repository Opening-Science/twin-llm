-- A genome VCF import (#180): one row per variant record of a person's own
-- GRCh38 VCF, deleted with its dataset (cascade). The dataset keeps the build.

-- AlterTable
ALTER TABLE "personal_datasets" ADD COLUMN     "genome_build" TEXT;

-- CreateTable
CREATE TABLE "personal_variants" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chrom" TEXT NOT NULL,
    "pos" INTEGER NOT NULL,
    "variant_id" TEXT,
    "ref" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "genotype" TEXT,
    "filter" TEXT,

    CONSTRAINT "personal_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_variants_dataset_id_idx" ON "personal_variants"("dataset_id");

-- CreateIndex
CREATE INDEX "personal_variants_user_id_chrom_pos_idx" ON "personal_variants"("user_id", "chrom", "pos");

-- AddForeignKey
ALTER TABLE "personal_variants" ADD CONSTRAINT "personal_variants_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "personal_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allowed values, by hand: Prisma has no CHECK syntax. Only a VCF names a
-- build, and the only build imported is GRCh38.
ALTER TABLE "personal_datasets" DROP CONSTRAINT "personal_datasets_kind_check";
ALTER TABLE "personal_datasets" ADD CONSTRAINT "personal_datasets_kind_check" CHECK ("kind" IN ('fhir', 'lab-csv', 'table', 'apple-health', 'wearable', 'vcf'));
-- Written so that no part can be NULL: a CHECK that evaluates to NULL passes.
ALTER TABLE "personal_datasets" ADD CONSTRAINT "personal_datasets_genome_build_check" CHECK ((("kind" = 'vcf') = ("genome_build" IS NOT NULL)) AND COALESCE("genome_build", 'GRCh38') = 'GRCh38');
