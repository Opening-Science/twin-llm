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

## Two-layer personal data

| Layer            | What lives there                                                                                                                                                                                          | What does not                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Ark (device)     | Owner genome datasets (CLI 0.3.5: four slots under `v1/genome`). TwinLLM talks to the device only through `packages/ark-adapter` and never copies VCF, FASTA, or GFF bytes into Postgres.                 | Wearable streams, lab FHIR observations                                                 |
| Local PostgreSQL | Wearable connection + snapshot tables, Synthea warehouse (`subjects` / `bundles` / `observations`), audit hash chain, guideline catalogue + local embeddings (`guideline_documents` / `guideline_chunks`) | Genome file bytes; copyrighted guideline full text (gitignored `data/guidelines/` only) |

Ark data is personal. Set `DATA_MODE=personal` when the device is in use (OpenRouter is already blocked in that mode). `GENOME_SOURCE=none` (default) keeps the adapter from spawning `ark`; `GENOME_SOURCE=ark` plus optional `ARK_DEVICE` enable it. See `docs/ark.md`.
