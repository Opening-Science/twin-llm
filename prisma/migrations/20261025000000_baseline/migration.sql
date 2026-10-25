-- TwinLLM baseline. Generated with `prisma migrate diff --from-empty`, then
-- extended by hand with the parts the Prisma schema cannot describe; those are
-- marked "Hand-written" below.

-- Hand-written: guideline_chunks.embedding needs the pgvector extension, so
-- the database image must ship it (pgvector/pgvector:pg16, not postgres:16).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "model_response_status" AS ENUM ('STREAMING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataChoice" TEXT,
    "interest" TEXT,
    "disabledSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "step" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turns" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_responses" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "status" "model_response_status" NOT NULL DEFAULT 'STREAMING',
    "text" TEXT NOT NULL DEFAULT '',
    "reasoningText" TEXT,
    "attribution" JSONB,
    "responseDocument" JSONB,
    "timeToFirstTokenMs" INTEGER,
    "tokensPerSecond" DECIMAL(10,2),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "model_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oura_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "subjectKey" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oura_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oura_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "fhirBundle" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oura_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whoop_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whoop_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whoop_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "fhirBundle" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whoop_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_health_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "subjectKey" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_health_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_health_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "fhirBundle" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vitronic_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiTokenEnc" TEXT NOT NULL,
    "uploadSecretEnc" TEXT NOT NULL,
    "apiTokenName" TEXT,
    "tlsFingerprintSha256" TEXT,
    "probandId" INTEGER NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vitronic_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vitronic_subjects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "selfForUserId" TEXT,
    "probandId" INTEGER,
    "defaultViatarId" INTEGER,
    "consentRecordedAt" TIMESTAMP(3) NOT NULL,
    "consentBy" TEXT NOT NULL,
    "consentNote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vitronic_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vitronic_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "viatarId" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "markers" JSONB,
    "measures" JSONB,
    "presetName" TEXT,
    "fhirBundle" JSONB,
    "glbSha256" TEXT,
    "glbModelName" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vitronic_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "subject_ref" TEXT NOT NULL,
    "cohort_id" TEXT NOT NULL,
    "is_synthetic" BOOLEAN NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("subject_ref")
);

-- CreateTable
CREATE TABLE "bundles" (
    "sha" TEXT NOT NULL,
    "cohort_id" TEXT NOT NULL,
    "synthea_version" TEXT NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("sha")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "bundle_sha" TEXT NOT NULL,
    "fhir_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "loinc" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "value" DECIMAL(20,8) NOT NULL,
    "unit_ucum" TEXT NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_non_numeric" (
    "id" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "bundle_sha" TEXT NOT NULL,
    "fhir_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "loinc" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "value_type" TEXT NOT NULL,
    "raw_value" JSONB NOT NULL,

    CONSTRAINT "observation_non_numeric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guideline_documents" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'guideline',
    "title" TEXT NOT NULL,
    "society" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "doi" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "ingest_mode" TEXT NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "embedding_dim" INTEGER NOT NULL,

    CONSTRAINT "guideline_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guideline_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "section_heading" TEXT NOT NULL,
    "recommendation_id" TEXT,
    "rec_class" TEXT,
    "evidence_level" TEXT,
    "page" TEXT,
    "text" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,

    CONSTRAINT "guideline_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "seq" BIGSERIAL NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "subject_ref" TEXT,
    "tool" TEXT NOT NULL,
    "args_sha256" CHAR(64) NOT NULL,
    "result_sha256" CHAR(64) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "prev_hash" CHAR(64) NOT NULL,
    "hash" CHAR(64) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_profiles_userId_key" ON "onboarding_profiles"("userId");

-- CreateIndex
CREATE INDEX "threads_userId_updatedAt_idx" ON "threads"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "turns_threadId_createdAt_idx" ON "turns"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "model_responses_turnId_modelId_key" ON "model_responses"("turnId", "modelId");

-- CreateIndex
CREATE UNIQUE INDEX "oura_connections_userId_key" ON "oura_connections"("userId");

-- CreateIndex
CREATE INDEX "oura_snapshots_userId_syncedAt_idx" ON "oura_snapshots"("userId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "whoop_connections_userId_key" ON "whoop_connections"("userId");

-- CreateIndex
CREATE INDEX "whoop_snapshots_userId_syncedAt_idx" ON "whoop_snapshots"("userId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "google_health_connections_userId_key" ON "google_health_connections"("userId");

-- CreateIndex
CREATE INDEX "google_health_snapshots_userId_syncedAt_idx" ON "google_health_snapshots"("userId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vitronic_connections_userId_key" ON "vitronic_connections"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "vitronic_subjects_selfForUserId_key" ON "vitronic_subjects"("selfForUserId");

-- CreateIndex
CREATE INDEX "vitronic_subjects_userId_isSelf_idx" ON "vitronic_subjects"("userId", "isSelf");

-- CreateIndex
CREATE INDEX "vitronic_snapshots_subjectId_syncedAt_idx" ON "vitronic_snapshots"("subjectId", "syncedAt");

-- CreateIndex
CREATE INDEX "vitronic_snapshots_userId_syncedAt_idx" ON "vitronic_snapshots"("userId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vitronic_snapshots_subjectId_viatarId_key" ON "vitronic_snapshots"("subjectId", "viatarId");

-- CreateIndex
CREATE INDEX "subjects_cohort_id_idx" ON "subjects"("cohort_id");

-- CreateIndex
CREATE INDEX "observations_subject_ref_loinc_effective_at_idx" ON "observations"("subject_ref", "loinc", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "observations_bundle_sha_fhir_id_key" ON "observations"("bundle_sha", "fhir_id");

-- CreateIndex
CREATE UNIQUE INDEX "observation_non_numeric_bundle_sha_fhir_id_key" ON "observation_non_numeric"("bundle_sha", "fhir_id");

-- CreateIndex
CREATE INDEX "guideline_documents_source_idx" ON "guideline_documents"("source");

-- CreateIndex
CREATE INDEX "guideline_chunks_document_id_idx" ON "guideline_chunks"("document_id");

-- AddForeignKey
ALTER TABLE "onboarding_profiles" ADD CONSTRAINT "onboarding_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_responses" ADD CONSTRAINT "model_responses_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oura_connections" ADD CONSTRAINT "oura_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oura_snapshots" ADD CONSTRAINT "oura_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whoop_connections" ADD CONSTRAINT "whoop_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whoop_snapshots" ADD CONSTRAINT "whoop_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_health_connections" ADD CONSTRAINT "google_health_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_health_snapshots" ADD CONSTRAINT "google_health_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitronic_connections" ADD CONSTRAINT "vitronic_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitronic_subjects" ADD CONSTRAINT "vitronic_subjects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitronic_snapshots" ADD CONSTRAINT "vitronic_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitronic_snapshots" ADD CONSTRAINT "vitronic_snapshots_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "vitronic_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_subject_ref_fkey" FOREIGN KEY ("subject_ref") REFERENCES "subjects"("subject_ref") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_bundle_sha_fkey" FOREIGN KEY ("bundle_sha") REFERENCES "bundles"("sha") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_non_numeric" ADD CONSTRAINT "observation_non_numeric_subject_ref_fkey" FOREIGN KEY ("subject_ref") REFERENCES "subjects"("subject_ref") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_non_numeric" ADD CONSTRAINT "observation_non_numeric_bundle_sha_fkey" FOREIGN KEY ("bundle_sha") REFERENCES "bundles"("sha") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guideline_chunks" ADD CONSTRAINT "guideline_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "guideline_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: approximate nearest-neighbour search over embeddings with
-- cosine distance. The name is asserted by scripts/db/verify-pgvector.sh.
CREATE INDEX "guideline_chunks_embedding_hnsw" ON "guideline_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Hand-written: the warehouse holds Synthea data only. Any other source,
-- including a personal wearable, is refused by the database itself.
ALTER TABLE "observations"
  ADD CONSTRAINT "observations_source_synthea" CHECK ("source" = 'synthea');
ALTER TABLE "observation_non_numeric"
  ADD CONSTRAINT "observation_non_numeric_source_synthea" CHECK ("source" = 'synthea');
