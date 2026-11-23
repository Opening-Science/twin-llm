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
contract, and B.5 for the sealing contexts. Only the expand step is in the schema so far: the new tables
exist, empty, with no foreign keys, and nothing reads them.

Each new row keeps its old row's id, and each `*_sealed` column holds the
old column's stored value byte for byte. A sealed value's context stays the
old `<table>.<column>.<id>` string, so copying needs no keys and a locked
vault does not stop it.

`schema_moves` has one row, `chat-tables`, from the expand migration until
the contract step. Its `phase` is `expanded`, then `backfilled`.
`schema_move_cursors` holds the backfill's position per table.

## Two-layer personal data

| Layer            | What lives there                                                                                                                                                                                          | What does not                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Ark (device)     | Owner genome datasets (CLI 0.5.0: six slots under `v1/genome`). TwinLLM talks to the device only through `packages/ark-adapter` and never copies VCF, FASTA, or GFF bytes into Postgres.                  | Wearable streams, lab FHIR observations                                                 |
| Local PostgreSQL | Wearable connection + snapshot tables, Synthea warehouse (`subjects` / `bundles` / `observations`), audit hash chain, guideline catalogue + local embeddings (`guideline_documents` / `guideline_chunks`) | Genome file bytes; copyrighted guideline full text (gitignored `data/guidelines/` only) |

Ark data is personal. Set `DATA_MODE=personal` when the device is in use (OpenRouter is already blocked in that mode). `GENOME_SOURCE=none` (default) keeps the adapter from spawning `ark`; `GENOME_SOURCE=ark` plus optional `ARK_DEVICE` enable it. See `docs/ark.md`.
