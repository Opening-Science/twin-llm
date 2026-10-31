-- The free text check of the disclosure ledger (#346): what kinds of stored values a request's text held, and how many.
-- AlterTable
ALTER TABLE "disclosure_events" ADD COLUMN     "free_text_matches" JSONB;
