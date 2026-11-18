#!/usr/bin/env bash
# The parts of the chat tables move that Prisma cannot describe, after
# migrate deploy (docs/storage.md, "Chat tables move"): the mirror triggers,
# the two partial indexes, the move marker and its phase check. Then one
# made-up thread, turn and answer in a rolled-back transaction must reach the
# new tables, and their delete must remove the copies.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-chat-move FAIL: DATABASE_URL is required" >&2
  exit 1
fi

sql() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "$1"
}

fail() {
  echo "verify-chat-move FAIL: $1" >&2
  exit 1
}

echo "=== mirror triggers (enabled) ==="
triggers="$(sql "SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'chat_move_mirror' AND t.tgenabled = 'O';")"
printf '%s\n' "${triggers}"
[[ "${triggers}" == "model_responses,scheduled_tasks,threads,turns" ]] ||
  fail "expected chat_move_mirror enabled on model_responses, scheduled_tasks, threads and turns"

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
[[ "${phase}" == "expanded" || "${phase}" == "backfilled" ]] ||
  fail "no chat-tables row in schema_moves"

echo "=== mirror probe (rolled back) ==="
probe="$(
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -t -A <<'SQL'
BEGIN;
INSERT INTO "users" ("id", "clerkId", "updatedAt") VALUES ('verify-chat-user', 'verify-chat-user', now());
INSERT INTO "threads" ("id", "userId", "title", "updatedAt") VALUES ('verify-chat-thread', 'verify-chat-user', 'made-up', now());
INSERT INTO "turns" ("id", "threadId", "prompt") VALUES ('verify-chat-turn', 'verify-chat-thread', 'made-up');
INSERT INTO "model_responses" ("id", "turnId", "modelId", "modelName") VALUES ('verify-chat-answer', 'verify-chat-turn', 'm', 'M');
SELECT 'copied ' || (SELECT count(*) FROM "conversations" WHERE "id" = 'verify-chat-thread')
  || (SELECT count(*) FROM "exchanges" WHERE "id" = 'verify-chat-turn')
  || (SELECT count(*) FROM "answers" WHERE "id" = 'verify-chat-answer' AND "state" = 'streaming');
DELETE FROM "threads" WHERE "id" = 'verify-chat-thread';
SELECT 'left ' || (SELECT count(*) FROM "conversations" WHERE "id" = 'verify-chat-thread')
  || (SELECT count(*) FROM "exchanges" WHERE "id" = 'verify-chat-turn')
  || (SELECT count(*) FROM "answers" WHERE "id" = 'verify-chat-answer');
ROLLBACK;
SQL
)"
printf '%s\n' "${probe}"
grep -q "^copied 111$" <<<"${probe}" || fail "a new thread, turn and answer were not copied"
grep -q "^left 000$" <<<"${probe}" || fail "deleting the thread left copies behind"

echo "verify-chat-move OK: triggers, partial indexes, marker and the mirror probe hold"
