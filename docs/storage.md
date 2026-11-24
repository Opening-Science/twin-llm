# Storage and migrations

TwinLLM uses PostgreSQL via Prisma 7 (`prisma/schema.prisma`, `prisma.config.ts`).

## Environment

| Variable              | Purpose                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | App + `migrate deploy` target                                                                   |
| `SHADOW_DATABASE_URL` | Shadow DB for `migrate diff` / `migrate dev` (set in `prisma.config.ts` from env; never commit) |

Example scratch pair (local Docker). Scratch and shadow must use `pgvector/pgvector:pg16` so `CREATE EXTENSION vector` can run:

```bash
export DATABASE_URL='postgresql://postgres:scratch@127.0.0.1:5433/postgres'
export SHADOW_DATABASE_URL='postgresql://postgres:scratch@127.0.0.1:5434/postgres'
```

`postgres:16` does not ship pgvector. Recreate throwaway scratch/shadow containers on the pgvector image. For `twinllm-dev`, dump first, stop the container, and start `pgvector/pgvector:pg16` on the **same data volume**. Never delete that volume. See `docs/guidelines.md`.

## Times

The older tables keep times as `timestamp(3)` holding UTC; the chat tables (`conversations`, `exchanges`, `answers`) use `timestamptz(3)`, and the backfill converts with `AT TIME ZONE 'UTC'`.
`@prisma/adapter-pg` writes a Date as UTC with no offset and drops the offset when it reads a `timestamptz`, so both are right only in a UTC session.
Every client is built with `postgresAdapter` (`infrastructure/database-adapter.ts`), which opens each connection with `-c TimeZone=UTC`, after any `options` in `DATABASE_URL`, whatever the server default (a local cluster takes the machine's zone).
`infrastructure/database-timezone.live.test.ts` checks this against a Europe/Zurich default, across both clock changes.

## Create a migration (local)

Against disposable scratch + shadow databases:

```bash
bun run db:migrate
# or: bunx prisma migrate dev --name <short_name>
```

Do not invent SQL by hand when the schema already describes the change — let Prisma emit it, then review.

## Apply migrations

```bash
bun run db:deploy
# or: bunx prisma migrate deploy
```

CI and production use **deploy** only (no `migrate dev`).

## Check for drift

After deploy, migrations must match `prisma/schema.prisma`:

```bash
bun run db:verify
```

That script (1) runs `migrate deploy` on `DATABASE_URL`, then (2) runs

`prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script --exit-code`

using `SHADOW_DATABASE_URL` from config. Exit `0` means no drift.

Some SQL is invisible to that diff, so the script also checks it on the
deployed database: pgvector and its HNSW indexes
(`scripts/db/verify-pgvector.sh`), and the chat tables move's mirror
triggers, partial indexes and marker, with a rolled-back probe that a new
thread is copied, an update of its answer and of the thread follows, and
its delete removes the copies
(`scripts/db/verify-chat-move.sh`).

## Baseline migration

The whole schema starts from one migration, `prisma/migrations/20261025000000_baseline`.
It was generated from `prisma/schema.prisma` and adds by hand what Prisma cannot
describe: the `vector` extension, `guideline_chunks.embedding` as `vector(768)`, the
HNSW cosine index and the `source = 'synthea'` CHECKs on both observation tables.

A database that already ran the earlier migrations has every table the baseline
creates. Mark the baseline as applied once instead of running it:

```bash
bunx prisma migrate resolve --applied 20261025000000_baseline
```

After that, `migrate status` reports the schema as up to date and `migrate deploy` has
nothing to apply. The old rows in `_prisma_migrations` can stay. Two leftovers from the
earlier history are no longer in the schema and can be dropped when convenient:
`DROP TABLE "votes";` and `DROP INDEX "model_responses_modelId_idx";`.

## Tool parts of an answer

`model_responses."toolParts"` (nullable JSONB) keeps the tool calls an answer
made, in step order: `[{ seq, tool, input, output, argsSha256, resultSha256,
rowCount, at }]`. The hashes are the audit row's (`packages/audit/hash.ts`),
so a stored part can be checked against the chain; `rowCount` is copied from
the audit row with the same hashes and is null when none matched. An answer
that used no tool stores null. `/t/[threadId]` replays the column as the
stream's `tool-<name>` parts (`features/compare/saved-answer.ts`); the
browser still receives only each tool's name and state.

## Chat tables move

`threads`, `turns` and `model_responses` are being replaced by
`conversations`, `exchanges` and `answers`. The column map is
`scripts/db/chat-move/tables.ts`. The move has four steps, each its own
release:

1. Expand: the new tables next to the old ones, and triggers that repeat
   every write on the old tables in the new ones.
2. Backfill and parity: copy the older rows, then prove every copy equals
   its old row.
3. Switch: the app reads and writes the new tables; reverse triggers keep
   the old ones current for a rollback.
4. Contract: after at least a week of use, drop the old tables. This is
   the only step that cannot be undone.

Code comments name these steps by the sections of the design note they
came from: C.1 expand, C.2 backfill, C.3 parity, C.4 switch, C.6
contract, and B.5 for the sealing contexts.

Steps 1 to 3 are in the schema. Since the switch the app reads and
writes `conversations`, `exchanges` and `answers`; `threads`, `turns` and
`model_responses` are kept current by reverse triggers until the contract
step, which is not built yet. The paragraphs below describe the steps in
order; the switch has its own subsection.

Before the switch, triggers named `chat_move_mirror` on `threads`, `turns` and
`model_responses` repeat every insert, update and delete on the new tables
in the same transaction (`scripts/db/chat-move/mirror-sql.ts`; rollback is
`DROP_MIRROR_SQL` there). A trigger on `scheduled_tasks` sets an exchange's
`schedule_id` when a run records its turn, and clears it when the task is
deleted. Rows older than the triggers are copied by the backfill:

```bash
bun run db:deploy          # expand + mirror migrations
bun run db:chat-backfill   # copy older rows, add the keys, mark backfilled
```

It reads in batches of 1,000 by id (`--batch-size=` to change), each batch
one transaction, and can be stopped and run again: it resumes from
`schema_move_cursors`, and a run after a finished one inserts nothing.
Copies already written by the triggers are left as they are. A scheduled
turn's `schedule_id` is the task whose `last_turn_id` names it, else the
one task on its thread, else null; `origin` always keeps the old flag. The
last step adds the foreign keys and the check that only scheduled
exchanges have a schedule, each `NOT VALID` and then validated; an orphaned
copy makes it fail and the move stays `expanded`. To undo it, run
`UNDO_FINISH_SQL` from `scripts/db/chat-move/backfill-sql.ts`; the copies
stay and the triggers keep them current.

Then check, read-only:

```bash
bun run db:chat-parity     # exit 0 only when every copy matches
```

Per table pair it prints row counts, old rows with no copy (`missing`),
copies with no old row (`extra`) and copies that differ in any column
(`differing`), then orphans and schedules on a person's exchange. Every
count must be 0 and the old and new row counts equal. Copies reported
missing are filled by `bun run db:chat-backfill --restart`, which reads
every old row again and still leaves existing copies alone.

Sealed columns of the new tables keep the old names as their context
(`infrastructure/chat-seal-contexts.ts`): `conversations.title_sealed` is
sealed as `threads.title`, `answers.body_sealed` as `model_responses.text`,
and so on. A copy equal byte for byte therefore opens exactly as the old
value does, which is why the gate needs no keys. With the vault unlocked,
`openProblems` in `scripts/db/chat-move/parity.ts` also opens every value
both ways and compares the text.

To roll the move back before the switch, take a fresh backup as for any
schema change, then:

```bash
bun run db:chat-rollback --yes   # ROLLBACK_SQL in one transaction
```

It runs `ROLLBACK_SQL` from `scripts/db/chat-move/rollback-sql.ts`, whole
or not at all. It drops the triggers, the new tables, their enums and
`schema_moves`, and deletes the three migrations' rows from
`_prisma_migrations` (Prisma's `migrate resolve --rolled-back` only takes a
failed migration). It prints the old tables' row counts before and after;
`threads`, `turns` and `model_responses` are not touched. The app can stay
as it is: only the doctor, the Lab card and the vault scripts read the
copies, and they skip copy tables that are gone. A later `bun run
db:deploy` applies the three migrations again, and `bun run
db:chat-backfill` copies everything again.

The steps so far are rehearsed by the live tests in `scripts/db/chat-move/`
on made-up rows: the column shapes, the triggers, the backfill stopped
halfway and resumed, the backfill, its finish step and the gate while two
sessions keep writing, the parity gate with a two-key test keyring, and the
rollback. They run with the other database tests on a throwaway, migrated
Postgres:

```bash
DATABASE_URL=<throwaway, migrated> bun run test:live-db
```

The new time columns are `timestamptz`; every connection runs in UTC so
Prisma reads and writes them as the instant Postgres holds (see
[Times](#times)).

Each new row keeps its old row's id, and each `*_sealed` column holds the
old column's stored value byte for byte. A sealed value's context stays the
old `<table>.<column>.<id>` string, so copying needs no keys and a locked
vault does not stop it.

`schema_moves` has one row, `chat-tables`, from the expand migration until
the contract step. Its `phase` is `expanded`, then `backfilled`, then
`switched`. `schema_move_cursors` holds the backfill's position per table.

### The switch

The migration `20261124120000_chat_tables_switch` holds `SWITCH_SQL` from
`scripts/db/chat-move/switch-sql.ts` (a test keeps them equal). In one
transaction it locks both sides, refuses unless the move is `backfilled`
and every copy matches (the `db:chat-parity` checks, run inside the
migration) or every chat table is empty (a new install), adds the new
tables' keys where they are missing, drops the mirror triggers, creates
`chat_move_reverse` on `conversations`, `exchanges` and `answers` (every
insert, update and delete repeated on the old table, mapped back), points
`scheduled_tasks.thread_id` and `thread_search_embeddings.thread_id` at
`conversations`, and marks the move `switched`. The two directions never
exist at once, so a write cannot bounce back. A new scheduled exchange
gets its task's id in `schedule_id` from the app.

The reseal list now names the new tables, each sealed column under its
frozen context, and the old tables are the copies that are checked but
never resealed: `vault:migrate` and `vault:rotate` rewrite the new tables
and the reverse triggers copy each value back byte for byte.
`db:chat-backfill` and `db:chat-rollback` refuse a switched move.

To switch, with a fresh backup and the app stopped:

```bash
bun run db:chat-parity     # must print parity OK
bun run db:deploy          # applies the switch migration
bash scripts/db/verify-chat-move.sh   # its probe is rolled back; never db:verify here
bun run db:chat-parity     # still OK; run it nightly during the soak
```

If the migration refuses (its message names the command to run), Prisma
records it as failed: run `bunx prisma migrate resolve --rolled-back
20261124120000_chat_tables_switch`, fix what the message names, and deploy
again. Nothing was changed.

To switch back during the soak, stop the app, then:

```bash
bun run db:chat-switch-back --yes   # SWITCH_BACK_SQL in one transaction
bun run db:chat-parity
```

It drops the reverse triggers, puts the mirror triggers back, points the
two keys at `threads` again, marks the move `backfilled` and forgets the
switch migration, so a later `bun run db:deploy` on the switched release
switches again. No row changes; it prints both sides' counts before and
after. Then run the release before the switch: its app reads the old
tables, which hold every write made since the switch.

The live tests in `scripts/db/chat-move/` rehearse the switch too: writes
reaching the old tables, every state's status, the cascades through the
repointed keys, a refused switch, switching back and again, and a reseal
reaching the old copies. The release-1 tests put the database back as it
was before the switch while they run, and switch it again after.

## Two-layer personal data

| Layer            | What lives there                                                                                                                                                                                          | What does not                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Ark (device)     | Owner genome datasets (CLI 0.5.0: six slots under `v1/genome`). TwinLLM talks to the device only through `packages/ark-adapter` and never copies VCF, FASTA, or GFF bytes into Postgres.                  | Wearable streams, lab FHIR observations                                                 |
| Local PostgreSQL | Wearable connection + snapshot tables, Synthea warehouse (`subjects` / `bundles` / `observations`), audit hash chain, guideline catalogue + local embeddings (`guideline_documents` / `guideline_chunks`) | Genome file bytes; copyrighted guideline full text (gitignored `data/guidelines/` only) |

Ark data is personal. Set `DATA_MODE=personal` when the device is in use (OpenRouter is already blocked in that mode). `GENOME_SOURCE=none` (default) keeps the adapter from spawning `ark`; `GENOME_SOURCE=ark` plus optional `ARK_DEVICE` enable it. See `docs/ark.md`.
