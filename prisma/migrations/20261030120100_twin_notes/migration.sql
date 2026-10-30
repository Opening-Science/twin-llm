-- Twin notes made with /compact, and the switch that turns loading them off (#43).
ALTER TABLE "onboarding_profiles" ADD COLUMN "twinNotesOff" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "twin_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "topics" TEXT[],
    "measures" TEXT[],
    "open_questions" TEXT[],
    "data_mode" TEXT NOT NULL,
    "permit" TEXT NOT NULL,
    "source_thread_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "twin_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "twin_notes_user_id_created_at_idx" ON "twin_notes"("user_id", "created_at");

ALTER TABLE "twin_notes" ADD CONSTRAINT "twin_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
