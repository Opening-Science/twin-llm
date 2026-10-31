-- Personal data encrypted at rest (#141, docs/privacy-design.md 2.3).
--
-- Every personal column becomes text: a sealed value is text, and JSON,
-- numbers and lists are kept as their JSON text. This migration converts
-- existing values without encrypting them; on a personal install,
-- `bun run vault:migrate` then seals them in place after a backup. The new
-- lookup columns hold keyed hashes and stay null until a row is sealed.

-- Conversations
ALTER TABLE "model_responses"
  ALTER COLUMN "attribution" SET DATA TYPE TEXT USING "attribution"::text,
  ALTER COLUMN "responseDocument" SET DATA TYPE TEXT USING "responseDocument"::text,
  ALTER COLUMN "toolParts" SET DATA TYPE TEXT USING "toolParts"::text;

-- Search vectors: personal installs keep them sealed and search in memory.
ALTER TABLE "thread_search_embeddings" ALTER COLUMN "embedding" DROP NOT NULL;
ALTER TABLE "thread_search_embeddings" ADD COLUMN "embedding_sealed" TEXT;

-- Wearables and body scans
ALTER TABLE "oura_snapshots"
  ALTER COLUMN "summary" SET DATA TYPE TEXT USING "summary"::text,
  ALTER COLUMN "fhirBundle" SET DATA TYPE TEXT USING "fhirBundle"::text;
ALTER TABLE "whoop_snapshots"
  ALTER COLUMN "summary" SET DATA TYPE TEXT USING "summary"::text,
  ALTER COLUMN "fhirBundle" SET DATA TYPE TEXT USING "fhirBundle"::text;
ALTER TABLE "google_health_snapshots"
  ALTER COLUMN "summary" SET DATA TYPE TEXT USING "summary"::text,
  ALTER COLUMN "fhirBundle" SET DATA TYPE TEXT USING "fhirBundle"::text;
ALTER TABLE "vitronic_snapshots"
  ALTER COLUMN "summary" SET DATA TYPE TEXT USING "summary"::text,
  ALTER COLUMN "markers" SET DATA TYPE TEXT USING "markers"::text,
  ALTER COLUMN "measures" SET DATA TYPE TEXT USING "measures"::text,
  ALTER COLUMN "fhirBundle" SET DATA TYPE TEXT USING "fhirBundle"::text;

-- Genome reports
ALTER TABLE "genome_reports" ALTER COLUMN "rows" SET DATA TYPE TEXT USING "rows"::text;

-- Imports
ALTER TABLE "personal_datasets" ADD COLUMN "sha256_index" TEXT;
DROP INDEX "personal_datasets_user_id_sha256_key";
CREATE UNIQUE INDEX "personal_datasets_user_id_sha256_index_key" ON "personal_datasets"("user_id", "sha256_index");

ALTER TABLE "personal_observations"
  ALTER COLUMN "value" SET DATA TYPE TEXT USING "value"::text,
  ADD COLUMN "lookup_index" TEXT,
  ADD COLUMN "series_index" TEXT;
DROP INDEX "personal_observations_user_id_code_effective_at_idx";
CREATE INDEX "personal_observations_user_id_lookup_index_effective_at_idx" ON "personal_observations"("user_id", "lookup_index", "effective_at");
CREATE INDEX "personal_observations_user_id_dataset_id_series_index_idx" ON "personal_observations"("user_id", "dataset_id", "series_index");

ALTER TABLE "personal_tables" ALTER COLUMN "columns" SET DATA TYPE TEXT USING "columns"::text;
ALTER TABLE "personal_table_chunks" ALTER COLUMN "rows" SET DATA TYPE TEXT USING "rows"::text;

ALTER TABLE "personal_variants"
  ALTER COLUMN "pos" SET DATA TYPE TEXT USING "pos"::text,
  ADD COLUMN "site_index" TEXT,
  ADD COLUMN "variant_id_index" TEXT[] DEFAULT ARRAY[]::TEXT[];
DROP INDEX "personal_variants_user_id_chrom_pos_idx";
CREATE INDEX "personal_variants_user_id_site_index_idx" ON "personal_variants"("user_id", "site_index");
CREATE INDEX "personal_variants_variant_id_index_idx" ON "personal_variants" USING GIN ("variant_id_index");

-- Twin notes: the three lists become JSON arrays of text (a missing list, '[]').
ALTER TABLE "twin_notes"
  ALTER COLUMN "topics" SET DATA TYPE TEXT USING COALESCE(to_json("topics")::text, '[]'),
  ALTER COLUMN "measures" SET DATA TYPE TEXT USING COALESCE(to_json("measures")::text, '[]'),
  ALTER COLUMN "open_questions" SET DATA TYPE TEXT USING COALESCE(to_json("open_questions")::text, '[]'),
  ALTER COLUMN "topics" SET NOT NULL,
  ALTER COLUMN "measures" SET NOT NULL,
  ALTER COLUMN "open_questions" SET NOT NULL;
