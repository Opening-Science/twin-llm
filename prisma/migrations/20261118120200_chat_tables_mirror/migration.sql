-- Chat tables, mirror triggers (.plans/compare-rewrite/DATA-MODEL.md C.1
-- step 2). Each write to threads, turns and model_responses is repeated on
-- conversations, exchanges and answers in the same transaction; deletes too,
-- including the cascade from a thread or a user. Generated from
-- scripts/db/chat-move/mirror-sql.ts; a test keeps this file equal to it.
-- Rollback: DROP_MIRROR_SQL in the same module.

CREATE FUNCTION "chat_move_mirror_threads"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."id" <> NEW."id") THEN
    DELETE FROM "conversations" WHERE "id" = OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  INSERT INTO "conversations" ("id", "owner_id", "title_sealed", "started_at", "last_activity_at")
  VALUES (NEW."id", NEW."userId", NEW."title", (NEW."createdAt" AT TIME ZONE 'UTC'), (NEW."updatedAt" AT TIME ZONE 'UTC'))
  ON CONFLICT ("id") DO UPDATE
    SET "owner_id" = EXCLUDED."owner_id",
        "title_sealed" = EXCLUDED."title_sealed",
        "started_at" = EXCLUDED."started_at",
        "last_activity_at" = EXCLUDED."last_activity_at";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_mirror" AFTER INSERT OR UPDATE OR DELETE ON "threads"
  FOR EACH ROW EXECUTE FUNCTION "chat_move_mirror_threads"();

CREATE FUNCTION "chat_move_mirror_turns"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."id" <> NEW."id") THEN
    DELETE FROM "exchanges" WHERE "id" = OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  INSERT INTO "exchanges" ("id", "conversation_id", "asked_at", "question_sealed", "bubble_text_sealed", "skill_name", "origin", "schedule_id")
  VALUES (NEW."id", NEW."threadId", (NEW."createdAt" AT TIME ZONE 'UTC'), NEW."prompt", NEW."label", NEW."skill", (CASE WHEN NEW."scheduled" THEN 'schedule' ELSE 'person' END)::"exchange_origin", CASE WHEN NEW."scheduled" THEN (
      SELECT min(s."id") FROM "scheduled_tasks" s
       WHERE s."thread_id" = NEW."threadId"
      HAVING count(*) = 1
    ) END)
  ON CONFLICT ("id") DO UPDATE
    SET "conversation_id" = EXCLUDED."conversation_id",
        "asked_at" = EXCLUDED."asked_at",
        "question_sealed" = EXCLUDED."question_sealed",
        "bubble_text_sealed" = EXCLUDED."bubble_text_sealed",
        "skill_name" = EXCLUDED."skill_name",
        "origin" = EXCLUDED."origin",
        "schedule_id" = COALESCE("exchanges"."schedule_id", EXCLUDED."schedule_id");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_mirror" AFTER INSERT OR UPDATE OR DELETE ON "turns"
  FOR EACH ROW EXECUTE FUNCTION "chat_move_mirror_turns"();

CREATE FUNCTION "chat_move_mirror_model_responses"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."id" <> NEW."id") THEN
    DELETE FROM "answers" WHERE "id" = OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  INSERT INTO "answers" ("id", "exchange_id", "answerer_ref", "answerer_label", "column_index", "state", "body_sealed", "reasoning_sealed", "evidence_sealed", "document_sealed", "tool_trace_sealed", "first_token_ms", "tokens_per_second", "input_tokens", "output_tokens", "total_tokens", "cost_usd", "opened_at", "closed_at")
  VALUES (NEW."id", NEW."turnId", NEW."modelId", NEW."modelName", NEW."position", lower(NEW."status"::text)::"answer_state", NEW."text", NEW."reasoningText", NEW."attribution", NEW."responseDocument", NEW."toolParts", NEW."timeToFirstTokenMs", NEW."tokensPerSecond", NEW."inputTokens", NEW."outputTokens", NEW."totalTokens", NEW."costUsd", (NEW."createdAt" AT TIME ZONE 'UTC'), (NEW."completedAt" AT TIME ZONE 'UTC'))
  ON CONFLICT ("id") DO UPDATE
    SET "exchange_id" = EXCLUDED."exchange_id",
        "answerer_ref" = EXCLUDED."answerer_ref",
        "answerer_label" = EXCLUDED."answerer_label",
        "column_index" = EXCLUDED."column_index",
        "state" = EXCLUDED."state",
        "body_sealed" = EXCLUDED."body_sealed",
        "reasoning_sealed" = EXCLUDED."reasoning_sealed",
        "evidence_sealed" = EXCLUDED."evidence_sealed",
        "document_sealed" = EXCLUDED."document_sealed",
        "tool_trace_sealed" = EXCLUDED."tool_trace_sealed",
        "first_token_ms" = EXCLUDED."first_token_ms",
        "tokens_per_second" = EXCLUDED."tokens_per_second",
        "input_tokens" = EXCLUDED."input_tokens",
        "output_tokens" = EXCLUDED."output_tokens",
        "total_tokens" = EXCLUDED."total_tokens",
        "cost_usd" = EXCLUDED."cost_usd",
        "opened_at" = EXCLUDED."opened_at",
        "closed_at" = EXCLUDED."closed_at";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_mirror" AFTER INSERT OR UPDATE OR DELETE ON "model_responses"
  FOR EACH ROW EXECUTE FUNCTION "chat_move_mirror_model_responses"();

CREATE FUNCTION "chat_move_mirror_scheduled_tasks"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "exchanges" SET "schedule_id" = NULL WHERE "schedule_id" = OLD."id";
    RETURN OLD;
  END IF;
  IF NEW."last_turn_id" IS NOT NULL THEN
    UPDATE "exchanges" SET "schedule_id" = NEW."id"
     WHERE "id" = NEW."last_turn_id" AND "origin" = 'schedule'
       AND "schedule_id" IS DISTINCT FROM NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_mirror" AFTER INSERT OR UPDATE OF "last_turn_id" OR DELETE ON "scheduled_tasks"
  FOR EACH ROW EXECUTE FUNCTION "chat_move_mirror_scheduled_tasks"();
