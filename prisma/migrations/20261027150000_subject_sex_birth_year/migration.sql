-- Sex, birth year and death year for synthetic subjects (#4). Additive and
-- nullable: rows ingested before this stay null until `warehouse:ingest` is
-- re-run over their bundles or `setup:local -- --reload-cohort` reloads them.
-- Only the year is kept, never the full birth or death date.

-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "birth_year" INTEGER,
ADD COLUMN     "death_year" INTEGER,
ADD COLUMN     "sex" TEXT;

-- FHIR Patient.gender (administrative gender) as Synthea writes it.
ALTER TABLE "subjects"
  ADD CONSTRAINT "subjects_sex_fhir_gender" CHECK (
    "sex" IS NULL OR "sex" IN ('female', 'male', 'other', 'unknown')
  );

-- Death cannot come before birth.
ALTER TABLE "subjects"
  ADD CONSTRAINT "subjects_death_after_birth" CHECK (
    "birth_year" IS NULL OR "death_year" IS NULL OR "death_year" >= "birth_year"
  );

-- These facts are kept for synthetic subjects only, never for anyone else.
ALTER TABLE "subjects"
  ADD CONSTRAINT "subjects_facts_synthetic_only" CHECK (
    "is_synthetic" OR ("sex" IS NULL AND "birth_year" IS NULL AND "death_year" IS NULL)
  );
