-- Chat tables, expand phase (.plans/compare-rewrite/DATA-MODEL.md C.1): the
-- new conversations, exchanges and answers tables next to threads, turns and
-- model_responses. Nothing reads or writes them yet. No foreign keys between
-- them or to users and scheduled_tasks: those are added once the backfill has
-- run, so copies can arrive in any order. Ids are the old rows' ids.

CREATE TYPE "exchange_origin" AS ENUM ('person', 'schedule');

CREATE TYPE "answer_state" AS ENUM ('streaming', 'complete', 'failed', 'refused', 'stopped');

CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title_sealed" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversations_owner_id_last_activity_at_idx" ON "conversations"("owner_id", "last_activity_at" DESC);

CREATE TABLE "exchanges" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "asked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "question_sealed" TEXT NOT NULL,
    "bubble_text_sealed" TEXT,
    "skill_name" TEXT,
    "origin" "exchange_origin" NOT NULL DEFAULT 'person',
    "schedule_id" TEXT,

    CONSTRAINT "exchanges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "exchanges_conversation_id_asked_at_idx" ON "exchanges"("conversation_id", "asked_at");

-- Partial: most exchanges were asked by a person and have no schedule.
CREATE INDEX "exchanges_schedule_id_idx" ON "exchanges"("schedule_id") WHERE "schedule_id" IS NOT NULL;

CREATE TABLE "answers" (
    "id" TEXT NOT NULL,
    "exchange_id" TEXT NOT NULL,
    "answerer_ref" TEXT NOT NULL,
    "answerer_label" TEXT NOT NULL,
    "column_index" INTEGER,
    "state" "answer_state" NOT NULL DEFAULT 'streaming',
    "body_sealed" TEXT NOT NULL DEFAULT '',
    "reasoning_sealed" TEXT,
    "evidence_sealed" TEXT,
    "document_sealed" TEXT,
    "tool_trace_sealed" TEXT,
    "first_token_ms" INTEGER,
    "tokens_per_second" DECIMAL(10,2),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cost_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "answers_exchange_id_answerer_ref_key" ON "answers"("exchange_id", "answerer_ref");

-- Partial: the start-up release of interrupted scheduled runs scans open rows only.
CREATE INDEX "answers_state_idx" ON "answers"("state") WHERE "state" = 'streaming';
