-- CreateTable
CREATE TABLE "genome_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "arkBuild" TEXT,
    "rows" JSONB NOT NULL,
    "report" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "genome_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "genome_reports_userId_app_releasedAt_idx" ON "genome_reports"("userId", "app", "releasedAt");

-- AddForeignKey
ALTER TABLE "genome_reports" ADD CONSTRAINT "genome_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
