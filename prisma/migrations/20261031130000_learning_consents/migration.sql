-- Consent to learn from personal data (#145): one row per grant, off by default.
-- CreateTable
CREATE TABLE "learning_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "sources" TEXT[],
    "wording" TEXT NOT NULL,
    "wording_version" TEXT NOT NULL,
    "wording_sha256" CHAR(64) NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "audit_seq" BIGINT NOT NULL,

    CONSTRAINT "learning_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_consents_user_id_scope_idx" ON "learning_consents"("user_id", "scope");

-- AddForeignKey
ALTER TABLE "learning_consents" ADD CONSTRAINT "learning_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

