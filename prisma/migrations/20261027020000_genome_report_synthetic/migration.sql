-- Synthetic genome reports (scripts/genome-synth) for synthetic cohort subjects.
-- A report belongs to a user (a person's own, isSynthetic false) or to a
-- synthetic subject (isSynthetic true), never both and never neither.

-- AlterTable
ALTER TABLE "genome_reports" ALTER COLUMN "userId" DROP NOT NULL,
ADD COLUMN     "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subjectRef" TEXT;

-- CreateIndex
CREATE INDEX "genome_reports_subjectRef_app_releasedAt_idx" ON "genome_reports"("subjectRef", "app", "releasedAt");

-- AddForeignKey
ALTER TABLE "genome_reports" ADD CONSTRAINT "genome_reports_subjectRef_fkey" FOREIGN KEY ("subjectRef") REFERENCES "subjects"("subject_ref") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one owner, and the synthetic flag says which.
ALTER TABLE "genome_reports"
  ADD CONSTRAINT "genome_reports_one_owner" CHECK (
    ("isSynthetic" AND "subjectRef" IS NOT NULL AND "userId" IS NULL)
    OR (NOT "isSynthetic" AND "userId" IS NOT NULL AND "subjectRef" IS NULL)
  );
