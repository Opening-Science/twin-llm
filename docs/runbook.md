# Runbook

Operational commands, each with the date it last ran and what a good result looks like. Times are Europe/Zurich. Connection strings below point only at throwaway local containers; never paste a real `DATABASE_URL` here.

## open-twin sync

### `bash scripts/sync-open-twin.sh <sha>`

Checks out open-twin at `<sha>` into the gitignored `.open-twin/`, builds `fhir-core`, `fhir-r4`, `interpretation-contract`, `anchor-layer` and the four providers, and pins their `fhir-core` peer. It never edits upstream `*.ts`. `@open-twin/interpreter` is not synced. Upgrade procedure: `docs/open-twin-pins.md`.

```sh
bash scripts/sync-open-twin.sh a9e126c952c91e19e064a962dda7d815a43564e5
git -C .open-twin rev-parse HEAD
git -C .open-twin status --porcelain -- '*.ts' | wc -l
```

- Good: `sync-open-twin OK: … @ a9e126c…`, `rev-parse` prints the same SHA, and porcelain prints `0`.
- Then run `bun install` and `bun run sync:verify`, as in the upgrade procedure in `docs/open-twin-pins.md`.
- Last run: 2026-10-17 21:36 CEST (default SHA `a9e126c`; `rev-parse` matches; `anchor-layer` dist present; porcelain `*.ts` 0). Package.json rewrites for `workspace:*` → peer-pin are expected and are not `*.ts` edits.

### `bun run sync:verify`

Smoke tests that the synced packages resolve and export what the host pins, including `normaliseBundle` from `@open-twin/fhir-r4` and `validateInterpretationDocument` from `@open-twin/interpretation-contract`.

- Good: 8 pass, 0 fail (the eighth checks the anchor-layer JSON against its sha256 sidecar).
- Last run: 2026-10-17 21:34 CEST, 8 pass / 0 fail (pin `a9e126c`).

### Operator: cycle through `@open-twin/provider-vitronic` (never CI)

Dry-run first, then `--execute` with `BODYLOOP_TLS_FINGERPRINT`, host Sync on that scan, then count FHIR `bundle.entry` via `createBodyLoopClient({ apiToken, tlsFingerprintSha256 })` → `getAvailableViatars(client, probandId)` → `getFhirBundleFromVitronicData`. Do not use `packages/vitronic/client.ts` for this check. Fail if the eval hits `/probands` or the password grant.

```sh
bun run vitronic:cycle create-scan --proband-id <n>
bun run vitronic:cycle start --viatar-id <n> --target analyzed_avatar_3d
bun run vitronic:cycle create-scan --proband-id <n> --execute
bun run vitronic:cycle start --viatar-id <n> --target analyzed_avatar_3d --execute
```

- Good: dry-run prints method/path/shape only; `--execute` completes with the TLS pin; library bundle `entry.length` > 0; D15 property Observations carry `m` / `m2` / `m3` / `kg` / `kg/m2`.
- Last run: not this session (needs the scanner).

## Warehouse / Synthea

### `bun run synthea:generate`

Runs `scripts/synthea/generate-local.sh`. Java 21+, Synthea `v4.0.0` JAR checksum `ed43c20ad40ba5c3bc724503a5af032715fe3c491620b766148e7c2361e6ecc1`, seed `42`, clinician seed `43`. `SYNTHEA_POPULATION` defaults to 10. Writes only under `.synthea/` (gitignored).

```sh
SYNTHEA_POPULATION=30 SYNTHEA_AGE=40-75 bun run synthea:generate
```

- Good: prints `manifest.json` with `syntheaVersion: "v4.0.0"`, `seed: 42` and `age`. `patientFileCount` can be above N because deceased patients are exported too. `.synthea/` is not committed.
- Last run: 2026-10-15 17:59 CEST, N=30, age 40-75 → 35 files, 163 MB (OpenJDK 21.0.12).

### Seed the synthetic warehouse

Added 2026-10-15. Generate, ingest, then check counts. Synthetic rows only; it writes to whatever `DATABASE_URL` points at (the local dev database).

```sh
SYNTHEA_POPULATION=30 SYNTHEA_AGE=40-75 bun run synthea:generate
bun run warehouse:ingest .synthea/fhir --cohort synthea-v4-seed42
bun run warehouse:ingest .synthea/fhir --cohort synthea-v4-seed42   # second run: all skipped
```

- Good: first run `Bundles: 35 inserted, 0 already ingested, 0 rejected`, `Cohort synthea-v4-seed42: 35 subjects`, and per-LOINC rows including `8480-6`, `8462-4`, `8867-4`, `29463-7`, `4548-4`. Second run `0 inserted, 35 already ingested, 0 rejected`.
- Any `rejected (...)` line exits 1. Report it; do not loosen the UCUM rule.
- Last run: 2026-10-15 CEST against `twinllm-dev`: 35 subjects, 24,541 numeric rows, second run 35 skipped. With `DATA_MODE=synthetic`, `observations_for_subject` (`8480-6`) returned 10 rows and `summary_stats` (`29463-7`) n=10 kg for the first listed subject; personal mode returned `SUBJECT_SCOPE_VIOLATION`.

### Synthetic demo (`.env.synthetic.example`)

Added 2026-10-16. Chat answers from the synthetic cohort only: `DATA_MODE=synthetic`, `LOCAL_ONLY=true`, Ollama on loopback, no cloud keys. The chat route reads no wearable snapshot in this mode, and the system prompt tells the model to use `list_subjects` and the query tools.

```sh
cp .env.synthetic.example .env.local      # then set DATABASE_URL to a synthetic-only database
bun run warehouse:ingest .synthea/fhir --cohort synthea-v4-seed42   # or tests/fixtures/synthea --cohort open-twin-synthea-trimmed-3
bun run dev
```

- Good: ask "What is the latest heart rate for subject_ref <one from list_subjects>?" The answer's tool calls show `latest_by_loinc` (or `list_subjects` first) with rows.
- Seed steps are in "Seed the synthetic warehouse" above. Which models make tool calls: [providers.md](providers.md#tool-calls-by-model).

### Data page (`/data`)

Added 2026-10-24. The Data page in the sidebar shows the synthetic cohorts, their subjects and the training conversations. It reads only in `DATA_MODE=synthetic`.

```sh
bun run dev -p 3012
# optional, for the Training data tab (smoke set; never train on the evaluation cohort):
bun run training:conversations -- --cohort synthea-v4-seed42 --allow-eval-cohort \
  --max-subjects 12 --out training-data/out/smoke-seed42.jsonl
```

- Good: `/data` shows the cohort picker, six tiles, the most common LOINC codes as a share of subjects, observations per year and the coverage bands. `/data/subjects` sorts and pages; a subject opens with a chart per code and unit and a latest-values table. `/data/training` lists the set with counts per family and outcome, and a conversation shows its tool calls and results.
- Audit: each overview, subject list and subject read adds one `audit_events` row (`data-explorer.cohort.overview`, `data-explorer.cohort.subjects`, `data-explorer.subject.observations`).
- Personal mode: every tab says the page shows synthetic data only and reads nothing.
- Last run: 2026-10-24 CEST against a local database with 200 subjects in `synthea-v4-seed42` (123,361 numeric rows, 178 codes) and a 76-conversation smoke set; pages checked at 1440 px (dark) and 375 px (light), no horizontal scroll at 375.

### Training data from the 1M cohort (`training:batches`)

Added 2026-10-25. Turns the 1M Synthea batches into training conversations one batch at a time, in a database of its own (never the dev database).

```sh
psql -h 127.0.0.1 -U postgres -c 'CREATE DATABASE twin_llm_training'
psql -h 127.0.0.1 -U postgres -d twin_llm_training -c 'CREATE EXTENSION vector'
cp .env.synthetic.example .env.training   # DATABASE_URL=.../twin_llm_training
DATABASE_URL="$(grep '^DATABASE_URL=' .env.training | cut -d= -f2-)" bunx prisma migrate deploy
bun run training:batches -- --batches 1001 --skip-rejected
```

- Good: one line per step (unpack, wearables, ingest fhir, ingest wearables, conversations, clear rows, remove files), each with a time, then `done in …`. The ingest fhir line ends `skipped 36 of 11416 bundles (22 ot-unit-policy, 14 ot-quantity-no-code)`. `training-data/out/synthea-v4-seed1001.{jsonl,meta.jsonl,manifest.json,rejected.json}`, with `rejected_bundles` in the manifest; no subjects left in the database; `.synthea/batches/synthea-v4-seed1001` gone. A second run prints `conversations already written, skipped`.
- Without `--skip-rejected` the batch stops at ingest fhir and says to pass it. More than 1% rejected stops it even with the flag.
- Against the dev database it prints `Refused: twin_llm_synthetic is the dev database …` and does nothing.
- A training database made before the 2026-10-25 baseline holds only audit rows between batches: drop and recreate it rather than resolving the baseline.
- Last run: 2026-10-25 CET, batch 1001 with `--skip-rejected` on a database made from the baseline: about 83 minutes, 36 bundles skipped, 68,906 conversations, 254.0 MB JSONL, 53 GB peak disk. Batch 1100 the same day: 1h 26m, 43 skipped, 69,065 conversations.

### `bun test packages/warehouse`

Ingests the three open-twin trimmed fixtures (five numeric rows each at pin `24179d8`, unresolved Encounter URNs listed) plus a constructed no-Encounter happy path.

```sh
bun test packages/warehouse
```

- Good: fixture inventory + five named rows per fixture + second ingest inserts 0 + missing-unit typed reject + blood pressure components (incl. repeated LOINC) + Synthea marker and not-synthea reject + cohort conflict + alreadyIngested.
- Last run: 2026-10-15 CEST, 18 pass / 0 fail (pin `24179d8`, `unresolvedUrnPolicy: preserve`).

### `bun test packages/query-tools packages/audit`

Query tools against the constructed patient-2 warehouse rows; scope refusal + audit hash; OpenAI/MCP schema snapshots; `verifyChain` on 20 events then one tampered row.

```sh
bun test --preload ./features/chat/response/preload-server-only.mjs packages/query-tools packages/audit
```

- Good: tool oracles (including `72514-3` = 1 `{score}` and `59576-9` = 92.377 `%`), cohort allowlist in/out, scope+audit, snapshots, 20-ok / 1-broken chain, exactly 5000 rows accepted, a tool that throws audited with 0 rows.
- Last run: 2026-10-17 15:33 CEST, 89 pass / 0 fail. Without the preload, `server-only` throws on import (also on main).

## Scratch Postgres (migrations only)

Two throwaway containers: one for the database and one for Prisma's shadow database. Both are started with `--rm`, so stopping them deletes them.

Guideline retrieval needs the `vector` extension. Use `pgvector/pgvector:pg16`, not stock `postgres:16`.

```sh
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
docker run --rm -d --name twinllm-scratch -e POSTGRES_PASSWORD=scratch -p 127.0.0.1:5433:5432 pgvector/pgvector:pg16
docker run --rm -d --name twinllm-shadow  -e POSTGRES_PASSWORD=scratch -p 127.0.0.1:5434:5432 pgvector/pgvector:pg16
```

- Last start: 2026-09-26 00:28 CEST.
- 2026-10-13: ports published on `127.0.0.1` only; containers started earlier with `-p 5433:5432` still listen on every interface until restarted.

```sh
docker rm -f twinllm-scratch twinllm-shadow
```

- Good: both names are printed, and `docker ps -a` lists neither.
- Last stop: 2026-09-26 12:18 CEST.
- 2026-10-15: `docker rm -f` instead of `docker stop`, so a scratch container started without `--rm` is removed too.

### Swap the `twinllm-dev` image (keep the volume)

Added 2026-10-15. Moving `twinllm-dev` from `postgres:16` to `pgvector/pgvector:pg16` keeps the data volume, but the two images ship different glibc versions, so Postgres warns about a collation version mismatch on first start.

1. Record counts with the query in step 2. Then dump, check mounts and recreate on the same volume: the steps in [guidelines.md](guidelines.md#postgres-image-data-preserving). Remove the container only (`docker stop twinllm-dev` then `docker rm twinllm-dev`); never `docker volume rm`.
2. Check counts against the ones recorded before the swap:

```sh
docker exec twinllm-dev psql -U postgres -d postgres -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"
```

3. Rebuild indexes and refresh the collation version in `postgres` and `template1`:

```sh
docker exec twinllm-dev psql -U postgres -d postgres -c "REINDEX DATABASE postgres;" -c "ALTER DATABASE postgres REFRESH COLLATION VERSION;"
docker exec twinllm-dev psql -U postgres -d template1 -c "REINDEX DATABASE template1;" -c "ALTER DATABASE template1 REFRESH COLLATION VERSION;"
```

- Good: counts match the pre-swap numbers; each `ALTER DATABASE` prints the version change (or "version has not changed"); a new `psql` session shows no collation warning.
- Last run: not yet run as written; the 2026-10-04 swap predates this entry.

## Migrations

### `bunx prisma migrate dev --name <short_name>` (scratch only)

Generates a new migration from `prisma/schema.prisma`. Run it only against the scratch containers, never a shared database.

```sh
DATABASE_URL=postgresql://postgres:scratch@localhost:5433/postgres \
SHADOW_DATABASE_URL=postgresql://postgres:scratch@localhost:5434/postgres \
bunx prisma migrate dev --name <short_name>
```

- Good: one new folder under `prisma/migrations/`, and `bun run db:verify` passes afterwards.
- Last run: not yet run on top of the 2026-10-25 baseline.

### Move an existing database onto the baseline (once)

On 2026-10-25 every earlier migration was replaced by `20261025000000_baseline`. A database that already has the tables records the baseline as applied instead of running it:

```sh
bunx prisma migrate resolve --applied 20261025000000_baseline
bunx prisma migrate status
```

- Good: `migrate status` prints "Database schema is up to date!" and `migrate deploy` prints "No pending migrations to apply." The unused `votes` table and `model_responses_modelId_idx` index stay until dropped by hand.
- Last run: 2026-10-25 on a scratch database that had deployed the old history from `main`: output as above. Not yet run on a maintainer database.

### `bun run db:verify`

`scripts/db/verify-migrations.sh` runs `migrate deploy`, diffs the migrations against the schema, probes pgvector (`scripts/db/verify-pgvector.sh`), probes the warehouse `source` CHECKs with `prisma db execute --stdin`, then seeds two audit events, tampers `seq = 1`, and expects `verifyChain` to fail at that seq.

`db:verify` needs the `psql` client on PATH. On macOS install it with Homebrew libpq (`brew install libpq`, then add `/opt/homebrew/opt/libpq/bin` to PATH in `~/.zshrc`). CI installs `postgresql-client`.

Reset scratch first: `docker rm -f twinllm-scratch twinllm-shadow`; start both again (above); then `db:verify`. A scratch that still has the migration history from before the 2026-10-25 baseline will not deploy cleanly.

```sh
DATABASE_URL=postgresql://postgres:scratch@localhost:5433/postgres \
SHADOW_DATABASE_URL=postgresql://postgres:scratch@localhost:5434/postgres \
bun run db:verify
```

- Good: migrations applied, empty diff or only the unmodelable HNSW `DROP INDEX`, pgvector probes hold, `verify-source-filter OK` (pgvector 0.8+, HNSW plan, 3/3 knowledge rows over 5000 guideline chunks), oura INSERT rejected by observations_source_synthea, synthea INSERT + ROLLBACK ok, audit chain ok then tamper breaks verifyChain at seq 1, verify-migrations OK.
- Last run: 2026-10-15 18:03 CEST, `verify-migrations OK` from an empty scratch (post-audit; fresh `pgvector/pgvector:pg16` containers on 5443/5444).

## Parallel worktrees

Added 2026-10-14. Each worktree owns one issue, one branch and one worktree beside the main checkout. Next allows one dev server per checkout, so each worktree runs its own on a fixed lane port.

### Create a worktree

```sh
git fetch origin
git worktree add ../twin-llm-<issue> -b <issue>-<slug> origin/main
cd ../twin-llm-<issue>
cp ../twin-llm/.env.local .env.local   # own copy per worktree; never commit
bun install
```

Anatomy meshes: either run `bun run anatomy:fetch` in the worktree, or set `ANATOMY_DATA_DIR` in its `.env.local` to the main checkout's `data/anatomy` as an absolute path.

### Dev server per lane

```sh
bun run dev -p 3011   # lane 1
bun run dev -p 3012   # lane 2
```

### Clean up after merge

```sh
git worktree remove ../twin-llm-<issue>
```

- Good: `git worktree list` shows the main checkout plus one entry per open lane; each lane's dev server answers on its own port.
- Last run: not yet run.

## Onboarding

### First-run flow at `/start`

Added 2026-10-24. Needs the `onboarding_profiles` table (in the baseline migration) and a chat model in the catalog.

1. Clear the local user's row so `/` sends you to the flow again (only for a user with no threads; one with a thread counts as set up, so open `/start` directly):

```sh
psql "$DATABASE_URL" -c "DELETE FROM onboarding_profiles USING users WHERE users.id = onboarding_profiles.\"userId\" AND users.\"clerkId\" = 'local';"
```

2. Open `/`. It should land on `/start`, step 1 of 5.
3. Pick a role and a data choice, Continue through Connect, Knowledge sources (turn one source off) and Where your data goes.
4. On the last step type an interest and Continue.

```sh
bun test features/onboarding infrastructure/knowledge-sources.test.ts features/chat/twin-system-prompt-sources.test.ts
```

- Good: "Thinking of a first question…", then three questions and a "Write your own" box. Picking one opens `/t/<id>` and the model starts answering. `/` no longer redirects. `onboarding_profiles` has the choices, the disabled source ids and a `completedAt`. With the model stopped or slow, the step shows the fixed starters for the role and the server log has `[onboarding] starter questions failed` or `timed out` with an error name only.
- Last run: 2026-10-24, `LOCAL_ONLY=true`, `DATA_MODE=synthetic`, Ollama `qwen3:8b`, dev server on :3011. Redirect, all five steps, model starters in about 18 s, starter thread opened and answered, Skip setup back to `/`, light and dark at phone width. Unit tests pass in `features/onboarding`; 2026-10-25 rerun after review fixes: switches for records and analytics move together, step 5 hint shows. Guideline and knowledge indexes were empty in that database, so those sources showed "Not indexed yet".

## Claim lint

### `bun run lint:claims`

Scans `app/**`, `features/**` and `packages/biomarkers/**` `.ts`/`.tsx` string literals (and JSX text) plus `README.md` and `docs/**/*.md`. Banned stems live in `scripts/lint-claims.ts`. Exceptions live in `docs/claims-allowlist.json`.

```sh
bun run lint:claims
```

- Good: exit 0. Prints `0 findings`, then `N allowlisted` and each `file:line reason`.
- Last run: 2026-09-27 14:50 CEST, `0 findings` / `1 allowlisted` (`features/shell/research-footer.tsx:2 required C4 footer`).

## Providers

### Infomaniak allowlist (mocked)

`GET {adapterBase}/models` is exercised by `infrastructure/fetch-model-catalog.test.ts` with a stubbed `fetch`. A 200 with two ids must return those ids and cache; a 500 must return `llama3`, `mixtral`, `qwen3`. No live token is used.

```sh
bun test infrastructure/fetch-model-catalog.test.ts
```

- Good: both tests pass.
- Last run: 2026-09-27 12:43 CEST, 2 pass / 0 fail (mocked `fetch`; no live Infomaniak call).

### Remote GPU (RunPod, SSH tunnel)

Added 2026-10-17. `LLM_PROVIDER=remote-gpu` sends chat to vLLM on a rented GPU through SSH tunnels on `127.0.0.1`. Synthetic data only: the app refuses to start with `DATA_MODE=personal` or `LOCAL_ONLY=true`, and the chat route refuses a request with wearable context. The pod bills per hour and may be shared with other work, so its owner starts and stops it; sessions never run RunPod commands or change what the pod serves.

1. Start the pod and its vLLM serve scripts (outside this repo).
2. Open the tunnel and check what each port serves:

```sh
ssh -N -L 8000:127.0.0.1:8000 -L 8002:127.0.0.1:8002 -p <PORT> root@<IP>
curl -s http://127.0.0.1:8000/v1/models
curl -s http://127.0.0.1:8002/v1/models
```

3. In `.env.local` (start from `.env.synthetic.example`): `DATA_MODE=synthetic`, `LOCAL_ONLY=false`, `LLM_PROVIDER=remote-gpu`, `REMOTE_GPU_BASE_URLS=http://127.0.0.1:8000/v1,http://127.0.0.1:8002/v1`. Then `bun run dev`.
4. Stop the pod when done; it bills per hour.

- Good: the model picker lists each served id under "Remote GPU (SSH tunnel)", and the footer says "Model served on a remote GPU through an SSH tunnel (synthetic data only)."
- Tunnel closed: the Models page says the catalog didn't answer, and the server log has `[model-catalog] remote-gpu skipped 127.0.0.1:8000 unreachable` per port. Nothing crashes.
- Tool calls need vLLM's `--enable-auto-tool-choice --tool-call-parser apertus`. Which served models call tools: [providers.md](providers.md#tool-calls-by-model).
- Last run: 2026-10-17, no-pod checks only. Tunnel ports closed: Models page empty state, one `skipped … unreachable` line per port. A stub `/v1/models` on one port: the model listed under "Remote GPU (SSH tunnel)". Live run not yet done: vLLM was not listening on the pod after a restart.

### Guardrail runner

```sh
bun test --preload ./features/chat/response/preload-server-only.mjs tests/guardrails
```

- Good: every case matches ABSTAIN, REFUSE, or the four headings in order, through `classifyCompletion` (`infrastructure/classify-completion.ts`), the same function the response builder uses. Both prompt modes carry the `REFUSE:` line. `RUN_LIVE` is unset.
- Last run: 2026-10-17 15:32 CEST, 23 pass / 0 fail (`RUN_LIVE` unset).
- 2026-10-17: without the preload, `server-only` throws on import before the file's `mock.module` runs (also on main); `bun run test` already preloads it.
- `RUN_LIVE=1` points the extra hook at `resolveLanguageModel` locally and is never set in CI.

### Guideline eval

```sh
bun test tests/guidelines
```

- Good: CITE keeps `sufficient_data` true when a wearable key is present; a guideline-only answer is CITE (`sufficient_data` false, `abstained` false, interpretation none); ABSTAIN applies when there is neither cited personal evidence nor a guideline citation. `GUIDELINE_EVAL` is unset.
- `GUIDELINE_EVAL=1` is a local-only hook and is never set in CI.

### Knowledge ingest

Added 2026-10-17. Writes `knowledge/opentwin/*.md` into the guideline tables with `source = 'opentwin-knowledge'`. Needs the migration and local Ollama with `nomic-embed-text`.

```sh
bun run knowledge:ingest
```

- Good: one line per file, then `pruned=<n>` (knowledge rows whose file is gone). A second run prints the same chunk counts and `pruned=0`.
- Last run: 2026-10-17, throwaway pgvector DB: `biomarker-catalogue` 15, `metric-glossary` 12, `provenance-and-audit` 7, `system-limits` 7, `units-and-codes` 8 chunks (49), `pruned=1` (a seeded stale row) then `pruned=0`. Chunk hash identical across both runs; the one `source = 'guideline'` row was untouched.
- After an open-twin pin bump: `bun run knowledge:biomarkers`, then re-ingest.

### Knowledge and guideline search in one database

```sh
RUN_LIVE=1 DATABASE_URL=<throwaway> bun test --preload ./features/chat/response/preload-server-only.mjs tests/knowledge/search-db.live.test.ts
```

- Needs guideline ingest (200+ chunks) and `knowledge:ingest` in the same throwaway database, and local `nomic-embed-text`.
- Good: "what does HRV measure?" returns the glossary HRV section from the knowledge source; a guideline query returns guideline rows only.
- At this size the planner uses a seq scan, which is exact. The HNSW path (where the filter used to drop small sources) is checked by `db:verify` (`scripts/db/verify-source-filter.ts`).

### Knowledge retrieval

```sh
RUN_LIVE=1 bun test --preload ./features/chat/response/preload-server-only.mjs tests/knowledge
```

- 20 questions in `tests/knowledge/cases.json`, each with an expected file and section. Chunks and questions are embedded the way ingest and `knowledge_search` do and ranked by cosine. Target: 16/20 in the top 3. Without `RUN_LIVE` only the offline check runs (every case points at a real section).
- Last run: 2026-10-17, MacBook, Ollama `nomic-embed-text`: **19/20 top-3 over 49 chunks.** The miss is `ferritin-loinc` ("Which LOINC code and unit does TwinLLM use for ferritin?"): the top 3 were "What a LOINC code is", "No unit conversion" and the catalogue intro. A single marker name inside a 12-marker list section loses to sections about LOINC and units in general. The cases were written alongside the corpus, so this number is optimistic for real questions.

## Response schema v1.1

### `bun test features/chat/response`

Builds `ResponseDocument` v1.1 from `parseTwinAnswer` + audit rows (`session_id` = `turnId`) + `DATA_MODE`. Three goldens, abstain, mocked `tool_calls`, fixture contract (nine SystemIds, renderer only), additive parse exports, and goldens for each `answer_class`, uncertainty level and `next_step`, plus a declined reply. A stored v1 document is covered in `infrastructure/response-document/parse.test.ts`.

```sh
bun test features/chat/response
```

- Good: goldens match, abstain is `kind=none` / `next_step=more_data`, a `REFUSE` reply is `declined_decision_support` / `consult_clinician`, fixture validates, copy is `Unverified narration` and `Not enough data — this reply is withheld.`
- Last run: 2026-10-17 15:32 CEST, 42 pass / 0 fail.
- Manual check 2026-10-17 (`DATA_MODE=synthetic`, `LOCAL_ONLY`, `qwen3:4b`, throwaway Postgres with `synthea-v4-seed42`): the melatonin dosing question came back as `REFUSE: …` → `declined_decision_support`, `high`, `["declined"]`, `consult_clinician`, reply withheld; a `trend` question on one synthetic subject (112 rows) → `analytics`, `low`, `[]`, `none`, narration matching a SQL fit. First token about 200 s for each (qwen3 thinking).
- Mapping and stub: `docs/response-schema.md`.
- `bun test` preloads `features/chat/response/preload-server-only.mjs` so `server-only` does not throw when guardrails import the system prompt.

## Ark adapter

Close the Ark Hub browser tab before any CLI command. Run one `ark` process at a
time. A second command or an open Hub tab returns `device-busy`.

### `bun test packages/ark-adapter`

Mocked spawn fixtures for `ok`, `locked`, `unpaired`, `busy`, `refused`,
`awaiting_approval`, and `error`. `RUN_ARK` is unset, so the live hardware test
is skipped.

```sh
bun test packages/ark-adapter
```

- Good: mocked states pass; live suite skipped.
- Last run: 2026-09-27 20:55 CEST (this change).

### `bun run ark:build` / `bun run ark:test`

Builds `apps/ark/rsid-genotypes/build/rsid-genotypes.wasm` (Rust 1.98,
`wasm32-wasip1`, wasm-opt from Binaryen 132; pin wasmtime 48.0.2 if Homebrew
is newer) and checks fixture goldens. Host `cargo test --locked` always runs.
The wasmtime two-pass runs when `wasmtime` and the wasm file are present. CI
job `ark-app` never sets `RUN_ARK`. Do not commit `build/` or `target/`.

```sh
bun run ark:build
bun run ark:test
```

- Good: `ark:test` prints cargo 6 passed, then `wasmtime two-pass goldens ok`
  when the WASI toolchain is installed. Local Homebrew rustc 1.98 without
  `wasm32-wasip1` still runs the host goldens and skips the wasmtime pass.
- Last run: 2026-09-28 11:05 CEST, host `cargo test --locked` 6 passed / 0
  failed (wasmtime not on PATH; wasm-opt not installed).

### `RUN_ARK=1` (local hardware only; never CI)

Calls `status`, `data list`, and `data paths` against `ARK_DEVICE`, then one
`appRun` of `rsid-genotypes.wasm`. Asserts the four slot names, that every
path starts with `v1/genome`, and that the app report has eleven rsID lines
plus the research-use footer. Close Hub first. Build the wasm first. Does
not pass `--unlock`. Approve the Companion prompt. The test does not print
the report.

```sh
bun run ark:build
GENOME_SOURCE=ark RUN_ARK=1 ARK_DEVICE=alpha-002 bun test packages/ark-adapter
```

- Good: one device, four named slots, every path under `v1/genome`, appRun
  `ok` after phone approval, eleven TSV rows, footer present.
- Last run: not a CI gate; local optional after `ark:build` and Companion
  approval. Confirm panel rsIDs are `available` with `ark data paths --json`
  first (read-only).
