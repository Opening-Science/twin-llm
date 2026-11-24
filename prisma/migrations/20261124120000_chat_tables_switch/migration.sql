-- Chat tables, switch (.plans/compare-rewrite/DATA-MODEL.md C.4): the app
-- now reads and writes conversations, exchanges and answers. Refuses unless
-- the move is backfilled and every copy matches (or every chat table is
-- empty). Adds the new tables' keys where they are missing, swaps the mirror
-- triggers for reverse ones (new to old, so the old tables stay complete
-- during the soak), points the scheduled_tasks and thread_search_embeddings
-- keys at conversations and marks the move switched. Generated from
-- scripts/db/chat-move/switch-sql.ts; a test keeps this file equal to it.
-- Switch back: bun run db:chat-switch-back --yes (SWITCH_BACK_SQL there).

LOCK TABLE "threads", "turns", "model_responses", "conversations", "exchanges", "answers" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  current_phase text;
  problems bigint;
BEGIN
  SELECT m."phase" INTO current_phase FROM "schema_moves" m WHERE m."move" = 'chat-tables';
  IF current_phase IS NULL THEN
    RAISE EXCEPTION 'chat-tables switch: no move marker; run bun run db:deploy from a release with the expand step';
  END IF;
  IF current_phase = 'switched' THEN
    RAISE EXCEPTION 'chat-tables switch: the move is switched already';
  END IF;
  IF current_phase = 'expanded' AND (
    EXISTS (SELECT 1 FROM "threads") OR EXISTS (SELECT 1 FROM "conversations")
  ) THEN
    RAISE EXCEPTION 'chat-tables switch: the move is not backfilled; run bun run db:chat-backfill, then bun run db:chat-parity';
  END IF;
  SELECT abs(c.old_rows - c.new_rows) + c.missing + c.extra + c.differing FROM (SELECT
    (SELECT count(*) FROM "threads")::int AS old_rows,
    (SELECT count(*) FROM "conversations")::int AS new_rows,
    (SELECT count(*) FROM "threads" o
      WHERE NOT EXISTS (SELECT 1 FROM "conversations" n WHERE n."id" = o."id"))::int AS missing,
    (SELECT count(*) FROM "conversations" n
      WHERE NOT EXISTS (SELECT 1 FROM "threads" o WHERE o."id" = n."id"))::int AS extra,
    (SELECT count(*) FROM "threads" o JOIN "conversations" n ON n."id" = o."id"
      WHERE ROW(o."id", o."userId", o."title", (o."createdAt" AT TIME ZONE 'UTC'), (o."updatedAt" AT TIME ZONE 'UTC')) IS DISTINCT FROM ROW(n."id", n."owner_id", n."title_sealed", n."started_at", n."last_activity_at"))::int AS differing) c INTO problems;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: conversations does not match threads; run bun run db:chat-parity';
  END IF;
  SELECT abs(c.old_rows - c.new_rows) + c.missing + c.extra + c.differing FROM (SELECT
    (SELECT count(*) FROM "turns")::int AS old_rows,
    (SELECT count(*) FROM "exchanges")::int AS new_rows,
    (SELECT count(*) FROM "turns" o
      WHERE NOT EXISTS (SELECT 1 FROM "exchanges" n WHERE n."id" = o."id"))::int AS missing,
    (SELECT count(*) FROM "exchanges" n
      WHERE NOT EXISTS (SELECT 1 FROM "turns" o WHERE o."id" = n."id"))::int AS extra,
    (SELECT count(*) FROM "turns" o JOIN "exchanges" n ON n."id" = o."id"
      WHERE ROW(o."id", o."threadId", (o."createdAt" AT TIME ZONE 'UTC'), o."prompt", o."label", o."skill", (CASE WHEN o."scheduled" THEN 'schedule' ELSE 'person' END)::"exchange_origin") IS DISTINCT FROM ROW(n."id", n."conversation_id", n."asked_at", n."question_sealed", n."bubble_text_sealed", n."skill_name", n."origin"))::int AS differing) c INTO problems;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: exchanges does not match turns; run bun run db:chat-parity';
  END IF;
  SELECT abs(c.old_rows - c.new_rows) + c.missing + c.extra + c.differing FROM (SELECT
    (SELECT count(*) FROM "model_responses")::int AS old_rows,
    (SELECT count(*) FROM "answers")::int AS new_rows,
    (SELECT count(*) FROM "model_responses" o
      WHERE NOT EXISTS (SELECT 1 FROM "answers" n WHERE n."id" = o."id"))::int AS missing,
    (SELECT count(*) FROM "answers" n
      WHERE NOT EXISTS (SELECT 1 FROM "model_responses" o WHERE o."id" = n."id"))::int AS extra,
    (SELECT count(*) FROM "model_responses" o JOIN "answers" n ON n."id" = o."id"
      WHERE ROW(o."id", o."turnId", o."modelId", o."modelName", o."position", lower(o."status"::text)::"answer_state", o."text", o."reasoningText", o."attribution", o."responseDocument", o."toolParts", o."timeToFirstTokenMs", o."tokensPerSecond", o."inputTokens", o."outputTokens", o."totalTokens", o."costUsd", (o."createdAt" AT TIME ZONE 'UTC'), (o."completedAt" AT TIME ZONE 'UTC')) IS DISTINCT FROM ROW(n."id", n."exchange_id", n."answerer_ref", n."answerer_label", n."column_index", n."state", n."body_sealed", n."reasoning_sealed", n."evidence_sealed", n."document_sealed", n."tool_trace_sealed", n."first_token_ms", n."tokens_per_second", n."input_tokens", n."output_tokens", n."total_tokens", n."cost_usd", n."opened_at", n."closed_at"))::int AS differing) c INTO problems;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: answers does not match model_responses; run bun run db:chat-parity';
  END IF;
  SELECT o.n INTO problems FROM (SELECT count(*)::int AS n FROM "conversations" c
             WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = c."owner_id")) o;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: conversations without their person; run bun run db:chat-parity';
  END IF;
  SELECT o.n INTO problems FROM (SELECT count(*)::int AS n FROM "exchanges" e
             WHERE NOT EXISTS (SELECT 1 FROM "conversations" c WHERE c."id" = e."conversation_id")) o;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: exchanges without their conversation; run bun run db:chat-parity';
  END IF;
  SELECT o.n INTO problems FROM (SELECT count(*)::int AS n FROM "answers" a
             WHERE NOT EXISTS (SELECT 1 FROM "exchanges" e WHERE e."id" = a."exchange_id")) o;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: answers without their exchange; run bun run db:chat-parity';
  END IF;
  SELECT o.n INTO problems FROM (SELECT count(*)::int AS n FROM "exchanges" e
             WHERE e."schedule_id" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM "scheduled_tasks" s WHERE s."id" = e."schedule_id")) o;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: schedules naming no task; run bun run db:chat-parity';
  END IF;
  SELECT o.n INTO problems FROM (SELECT count(*)::int AS n FROM "exchanges" e
             WHERE e."origin" = 'person' AND e."schedule_id" IS NOT NULL) o;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: schedules on a person''s exchange; run bun run db:chat-parity';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'conversations_owner_id_fkey' AND conrelid = '"conversations"'::regclass
  ) THEN
    ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END;
$$;

ALTER TABLE "conversations" VALIDATE CONSTRAINT "conversations_owner_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'exchanges_conversation_id_fkey' AND conrelid = '"exchanges"'::regclass
  ) THEN
    ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END;
$$;

ALTER TABLE "exchanges" VALIDATE CONSTRAINT "exchanges_conversation_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'exchanges_schedule_id_fkey' AND conrelid = '"exchanges"'::regclass
  ) THEN
    ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END;
$$;

ALTER TABLE "exchanges" VALIDATE CONSTRAINT "exchanges_schedule_id_fkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'exchanges_schedule_only_when_scheduled' AND conrelid = '"exchanges"'::regclass
  ) THEN
    ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_schedule_only_when_scheduled" CHECK ("origin" = 'schedule' OR "schedule_id" IS NULL) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE "exchanges" VALIDATE CONSTRAINT "exchanges_schedule_only_when_scheduled";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'answers_exchange_id_fkey' AND conrelid = '"answers"'::regclass
  ) THEN
    ALTER TABLE "answers" ADD CONSTRAINT "answers_exchange_id_fkey" FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END;
$$;

ALTER TABLE "answers" VALIDATE CONSTRAINT "answers_exchange_id_fkey";

DROP TRIGGER IF EXISTS "chat_move_mirror" ON "threads";

DROP FUNCTION IF EXISTS "chat_move_mirror_threads"();

DROP TRIGGER IF EXISTS "chat_move_mirror" ON "turns";

DROP FUNCTION IF EXISTS "chat_move_mirror_turns"();

DROP TRIGGER IF EXISTS "chat_move_mirror" ON "model_responses";

DROP FUNCTION IF EXISTS "chat_move_mirror_model_responses"();

DROP TRIGGER IF EXISTS "chat_move_mirror" ON "scheduled_tasks";

DROP FUNCTION IF EXISTS "chat_move_mirror_scheduled_tasks"();

CREATE FUNCTION "chat_move_reverse_conversations"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."id" <> NEW."id") THEN
    DELETE FROM "threads" WHERE "id" = OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  INSERT INTO "threads" ("id", "userId", "title", "createdAt", "updatedAt")
  VALUES (NEW."id", NEW."owner_id", NEW."title_sealed", (NEW."started_at" AT TIME ZONE 'UTC'), (NEW."last_activity_at" AT TIME ZONE 'UTC'))
  ON CONFLICT ("id") DO UPDATE
    SET "userId" = EXCLUDED."userId",
        "title" = EXCLUDED."title",
        "createdAt" = EXCLUDED."createdAt",
        "updatedAt" = EXCLUDED."updatedAt";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_reverse" AFTER INSERT OR UPDATE OR DELETE ON "conversations"
  FOR EACH ROW EXECUTE FUNCTION "chat_move_reverse_conversations"();

CREATE FUNCTION "chat_move_reverse_exchanges"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."id" <> NEW."id") THEN
    DELETE FROM "turns" WHERE "id" = OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  INSERT INTO "turns" ("id", "threadId", "createdAt", "prompt", "label", "skill", "scheduled")
  VALUES (NEW."id", NEW."conversation_id", (NEW."asked_at" AT TIME ZONE 'UTC'), NEW."question_sealed", NEW."bubble_text_sealed", NEW."skill_name", (NEW."origin" = 'schedule'))
  ON CONFLICT ("id") DO UPDATE
    SET "threadId" = EXCLUDED."threadId",
        "createdAt" = EXCLUDED."createdAt",
        "prompt" = EXCLUDED."prompt",
        "label" = EXCLUDED."label",
        "skill" = EXCLUDED."skill",
        "scheduled" = EXCLUDED."scheduled";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_reverse" AFTER INSERT OR UPDATE OR DELETE ON "exchanges"
  FOR EACH ROW EXECUTE FUNCTION "chat_move_reverse_exchanges"();

CREATE FUNCTION "chat_move_reverse_answers"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."id" <> NEW."id") THEN
    DELETE FROM "model_responses" WHERE "id" = OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  INSERT INTO "model_responses" ("id", "turnId", "modelId", "modelName", "position", "status", "text", "reasoningText", "attribution", "responseDocument", "toolParts", "timeToFirstTokenMs", "tokensPerSecond", "inputTokens", "outputTokens", "totalTokens", "costUsd", "createdAt", "completedAt")
  VALUES (NEW."id", NEW."exchange_id", NEW."answerer_ref", NEW."answerer_label", NEW."column_index", upper(NEW."state"::text)::"model_response_status", NEW."body_sealed", NEW."reasoning_sealed", NEW."evidence_sealed", NEW."document_sealed", NEW."tool_trace_sealed", NEW."first_token_ms", NEW."tokens_per_second", NEW."input_tokens", NEW."output_tokens", NEW."total_tokens", NEW."cost_usd", (NEW."opened_at" AT TIME ZONE 'UTC'), (NEW."closed_at" AT TIME ZONE 'UTC'))
  ON CONFLICT ("id") DO UPDATE
    SET "turnId" = EXCLUDED."turnId",
        "modelId" = EXCLUDED."modelId",
        "modelName" = EXCLUDED."modelName",
        "position" = EXCLUDED."position",
        "status" = EXCLUDED."status",
        "text" = EXCLUDED."text",
        "reasoningText" = EXCLUDED."reasoningText",
        "attribution" = EXCLUDED."attribution",
        "responseDocument" = EXCLUDED."responseDocument",
        "toolParts" = EXCLUDED."toolParts",
        "timeToFirstTokenMs" = EXCLUDED."timeToFirstTokenMs",
        "tokensPerSecond" = EXCLUDED."tokensPerSecond",
        "inputTokens" = EXCLUDED."inputTokens",
        "outputTokens" = EXCLUDED."outputTokens",
        "totalTokens" = EXCLUDED."totalTokens",
        "costUsd" = EXCLUDED."costUsd",
        "createdAt" = EXCLUDED."createdAt",
        "completedAt" = EXCLUDED."completedAt";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_reverse" AFTER INSERT OR UPDATE OR DELETE ON "answers"
  FOR EACH ROW EXECUTE FUNCTION "chat_move_reverse_answers"();

ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "scheduled_tasks_thread_id_fkey";

ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "scheduled_tasks" VALIDATE CONSTRAINT "scheduled_tasks_thread_id_fkey";

ALTER TABLE "thread_search_embeddings" DROP CONSTRAINT "thread_search_embeddings_thread_id_fkey";

ALTER TABLE "thread_search_embeddings" ADD CONSTRAINT "thread_search_embeddings_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "thread_search_embeddings" VALIDATE CONSTRAINT "thread_search_embeddings_thread_id_fkey";

ALTER TABLE "schema_moves" DROP CONSTRAINT "schema_moves_phase";

ALTER TABLE "schema_moves" ADD CONSTRAINT "schema_moves_phase" CHECK ("phase" IN ('expanded', 'backfilled', 'switched'));

UPDATE "schema_moves" SET "phase" = 'switched', "updated_at" = CURRENT_TIMESTAMP WHERE "move" = 'chat-tables';
