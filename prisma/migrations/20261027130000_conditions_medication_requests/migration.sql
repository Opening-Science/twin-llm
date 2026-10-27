-- Synthea Conditions and MedicationRequests, ingested with the observations of
-- the same bundle (packages/warehouse/ingest-bundle.ts). Synthetic only through
-- their subject (subjects.is_synthetic); source is 'synthea' as on observations.

-- CreateTable
CREATE TABLE "conditions" (
    "id" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "bundle_sha" TEXT NOT NULL,
    "fhir_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "code_system" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "onset_at" TIMESTAMP(3),
    "abatement_at" TIMESTAMP(3),
    "clinical_status" TEXT,
    "verification_status" TEXT,
    "encounter_ref" TEXT,

    CONSTRAINT "conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_requests" (
    "id" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "bundle_sha" TEXT NOT NULL,
    "fhir_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "code_system" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "authored_at" TIMESTAMP(3),
    "status" TEXT,
    "intent" TEXT,
    "dosage_text" TEXT[],
    "reason_refs" TEXT[],

    CONSTRAINT "medication_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conditions_subject_ref_onset_at_idx" ON "conditions"("subject_ref", "onset_at");

-- CreateIndex
CREATE UNIQUE INDEX "conditions_bundle_sha_fhir_id_key" ON "conditions"("bundle_sha", "fhir_id");

-- CreateIndex
CREATE INDEX "medication_requests_subject_ref_authored_at_idx" ON "medication_requests"("subject_ref", "authored_at");

-- CreateIndex
CREATE UNIQUE INDEX "medication_requests_bundle_sha_fhir_id_key" ON "medication_requests"("bundle_sha", "fhir_id");

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_subject_ref_fkey" FOREIGN KEY ("subject_ref") REFERENCES "subjects"("subject_ref") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_bundle_sha_fkey" FOREIGN KEY ("bundle_sha") REFERENCES "bundles"("sha") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_requests" ADD CONSTRAINT "medication_requests_subject_ref_fkey" FOREIGN KEY ("subject_ref") REFERENCES "subjects"("subject_ref") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_requests" ADD CONSTRAINT "medication_requests_bundle_sha_fkey" FOREIGN KEY ("bundle_sha") REFERENCES "bundles"("sha") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only Synthea rows, as on the observation tables.
ALTER TABLE "conditions"
  ADD CONSTRAINT "conditions_source_synthea" CHECK ("source" = 'synthea');
ALTER TABLE "medication_requests"
  ADD CONSTRAINT "medication_requests_source_synthea" CHECK ("source" = 'synthea');
