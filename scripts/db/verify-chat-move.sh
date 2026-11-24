#!/usr/bin/env bash
# The parts of the chat tables move that Prisma cannot describe, after
# migrate deploy (docs/storage.md, "Chat tables move"): since the switch, the
# reverse triggers and no mirror trigger, the two partial indexes, the move
# marker and the repointed keys. Then one made-up conversation, exchange and
# answer in a rolled-back transaction must reach the old tables, an update of
# the answer and the conversation must follow, and their delete must remove
# the old rows.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-chat-move FAIL: DATABASE_URL is required" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "verify-chat-move FAIL: psql is required (CI installs postgresql-client)" >&2
  exit 1
fi

sql() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "$1"
}

fail() {
  echo "verify-chat-move FAIL: $1" >&2
  exit 1
}

echo "=== reverse triggers (enabled), and no mirror trigger ==="
triggers="$(sql "SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'chat_move_reverse' AND t.tgenabled = 'O';")"
printf '%s\n' "${triggers}"
[[ "${triggers}" == "answers,conversations,exchanges" ]] ||
  fail "expected chat_move_reverse enabled on answers, conversations and exchanges"
mirrors="$(sql "SELECT count(*) FROM pg_trigger WHERE tgname = 'chat_move_mirror';")"
[[ "${mirrors}" == "0" ]] || fail "a chat_move_mirror trigger is left; a write would be copied both ways"

echo "=== keys pointing at conversations ==="
keys="$(sql "SELECT string_agg(conname || '>' || confrelid::regclass::text, ',' ORDER BY conname) FROM pg_constraint WHERE conname IN ('scheduled_tasks_thread_id_fkey', 'thread_search_embeddings_thread_id_fkey', 'exchanges_conversation_id_fkey', 'answers_exchange_id_fkey', 'conversations_owner_id_fkey', 'exchanges_schedule_id_fkey') AND convalidated;")"
printf '%s\n' "${keys}"
[[ "${keys}" == "answers_exchange_id_fkey>exchanges,conversations_owner_id_fkey>users,exchanges_conversation_id_fkey>conversations,exchanges_schedule_id_fkey>scheduled_tasks,scheduled_tasks_thread_id_fkey>conversations,thread_search_embeddings_thread_id_fkey>conversations" ]] ||
  fail "the chat keys are not all there, validated and pointing at the new tables"

echo "=== partial indexes ==="
partial="$(sql "SELECT string_agg(indexname || ': ' || substring(indexdef from 'WHERE .*'), E'\n' ORDER BY indexname) FROM pg_indexes WHERE indexname IN ('answers_state_idx', 'exchanges_schedule_id_idx');")"
printf '%s\n' "${partial}"
grep -q "^answers_state_idx: WHERE (state = 'streaming'::answer_state)$" <<<"${partial}" ||
  fail "answers_state_idx is not partial on state = 'streaming'"
grep -q "^exchanges_schedule_id_idx: WHERE (schedule_id IS NOT NULL)$" <<<"${partial}" ||
  fail "exchanges_schedule_id_idx is not partial on schedule_id IS NOT NULL"

echo "=== move marker ==="
phase="$(sql "SELECT phase FROM schema_moves WHERE move = 'chat-tables';")"
printf '%s\n' "${phase}"
[[ "${phase}" == "switched" ]] || fail "the chat-tables move is not marked switched"

echo "=== reverse probe (rolled back) ==="
probe="$(
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -t -A <<'SQL'
BEGIN;
INSERT INTO "users" ("id", "clerkId", "updatedAt") VALUES ('verify-chat-user', 'verify-chat-user', now());
INSERT INTO "conversations" ("id", "owner_id", "title_sealed") VALUES ('verify-chat-thread', 'verify-chat-user', 'made-up');
INSERT INTO "exchanges" ("id", "conversation_id", "question_sealed") VALUES ('verify-chat-turn', 'verify-chat-thread', 'made-up');
INSERT INTO "answers" ("id", "exchange_id", "answerer_ref", "answerer_label") VALUES ('verify-chat-answer', 'verify-chat-turn', 'm', 'M');
SELECT 'copied ' || (SELECT count(*) FROM "threads" WHERE "id" = 'verify-chat-thread')
  || (SELECT count(*) FROM "turns" WHERE "id" = 'verify-chat-turn')
  || (SELECT count(*) FROM "model_responses" WHERE "id" = 'verify-chat-answer' AND "status" = 'STREAMING');
UPDATE "answers" SET "state" = 'complete', "body_sealed" = 'made-up answer', "closed_at" = now() WHERE "id" = 'verify-chat-answer';
UPDATE "conversations" SET "last_activity_at" = TIMESTAMPTZ '2001-02-03 04:05:06.789+00' WHERE "id" = 'verify-chat-thread';
SELECT 'updated ' || (SELECT count(*) FROM "model_responses" WHERE "id" = 'verify-chat-answer' AND "status" = 'COMPLETE' AND "text" = 'made-up answer' AND "completedAt" IS NOT NULL)
  || (SELECT count(*) FROM "threads" WHERE "id" = 'verify-chat-thread' AND "updatedAt" = TIMESTAMP '2001-02-03 04:05:06.789');
DELETE FROM "conversations" WHERE "id" = 'verify-chat-thread';
SELECT 'left ' || (SELECT count(*) FROM "threads" WHERE "id" = 'verify-chat-thread')
  || (SELECT count(*) FROM "turns" WHERE "id" = 'verify-chat-turn')
  || (SELECT count(*) FROM "model_responses" WHERE "id" = 'verify-chat-answer');
ROLLBACK;
SQL
)"
printf '%s\n' "${probe}"
grep -q "^copied 111$" <<<"${probe}" || fail "a new conversation, exchange and answer were not copied back"
grep -q "^updated 11$" <<<"${probe}" || fail "completing the answer or bumping the conversation did not reach the old rows"
grep -q "^left 000$" <<<"${probe}" || fail "deleting the conversation left old rows behind"

echo "verify-chat-move OK: reverse triggers, keys, partial indexes, marker and the reverse probe hold"
