# Runbook

Operational commands, each with the date it last ran and what a good result looks like. Times are Europe/Zurich. Connection strings below point only at throwaway local containers; never paste a real `DATABASE_URL` here.

## Local setup

### `bun run setup:local`

Added 2026-10-26. One idempotent command that makes a fresh checkout (macOS or Linux) run like the maintainers' machines: Data page filled, Demo bodies that walk. `scripts/setup/local.ts`; the decisions are pure functions in `scripts/setup/plan.ts`.

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/twin_llm_synthetic bun run setup:local
bun run setup:local -- --cohort-10k    # the 10,000-person release instead of the eval cohort
bun run setup:local -- --skip-cohort   # everything but the cohort
bun run setup:local -- --reload-cohort # replace a stale evaluation cohort with the pinned one
bun run setup:local -- --generate-cohort # generate the eval cohort with Synthea instead of downloading it
bun run setup:local -- --skip-example  # do not add the "Example (synthetic)" thread
bun run setup:local -- --skip-training-sample # do not write the Training tab's sample set
bun run setup:local -- --owner-cluster # only: an owner-only Postgres for personal mode (see "Owner-only Postgres")
bun run doctor                         # read-only: the same checks, what each page needs, why /data is empty
```

1. Checks bun, Node.js, git, Python 3, Java 21+, shasum, curl, uv, zstd and Ollama, and whether Postgres answers at `DATABASE_URL` with pgvector available. Anything missing is printed with its Homebrew or apt line; nothing is installed.
2. Writes `.env.local` from `.env.synthetic.example` when there is none (`DATABASE_URL` from the shell; on macOS without one, `postgresql://$USER@127.0.0.1:5432/twin_llm_synthetic`). An existing `.env.local` is never touched.
3. `sync:open-twin` (skipped when `.open-twin/OPEN_TWIN_SHA` is the pin), `bun install`, creates the database when the server has none of that name, `prisma migrate deploy`.
4. `anatomy:fetch --skip-rigged` when an atlas or demo body is missing. When a rigged body is missing, `anatomy:fetch --rigged <id>` downloads it from the `anatomy-rigged-v1` release; only if that fails, `anatomy:bake-rigged` bakes it (needs uv; without uv the step is skipped with the install line). Walk/Idle/Dance say "Run bun run anatomy:fetch." until then.
5. When the warehouse has `synthea-v4-seed42` but not the pinned copy (subjects other than 37, ingested bundles whose fingerprint is not `bundleSetSha256` in `scripts/setup/cohort-pins.ts`: the SHA-256 of the sorted bundle hashes, computed in SQL from `bundles`, or condition and medication request counts other than `conditionCount` and `medicationRequestCount`, as when the pinned bundles were ingested before those tables existed), the step is `[stale]` with the fix and nothing is loaded. `--reload-cohort` downloads (or generates) and verifies the pinned cohort first, then deletes that cohort's rows from `observations`, `observation_non_numeric`, `conditions`, `medication_requests`, `bundles` and `subjects` (each scoped by the cohort id, in one transaction that rolls back if any other cohort's counts move or a row of this cohort is left), then ingests. Only `synthea-v4-seed42` can be reloaded, and only it and `open-twin-synthea-trimmed-3` can be deleted. When no allowlisted cohort other than the trimmed fixtures has subjects: downloads `eval-cohort-synthea-v4-seed42-20260101.tar.zst` (4,911,581 bytes) from release `eval-cohort-v1` to `.synthea/downloads/` (kept for re-runs; redirects only to GitHub's asset hosts), checks its SHA-256, unpacks it with zstd, checks 37 files, `contentSha256` `f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb` and the manifest's cohort id, puts it in `.synthea/fhir`, then `warehouse:ingest`. When the release is not published yet or cannot be reached, setup says so and runs `synthea:generate -- --preset eval` instead (needs Java); `--generate-cohort` does that on purpose. A generated cohort is checked against the same pin; a mismatch ingests nothing, and on arm64 (Apple Silicon) the checklist says it is a platform difference (floating point) and to use the download (`docs/warehouse.md`, "Other CPU architectures"). Without zstd setup generates; without zstd and Java, an empty warehouse gets the three trimmed fixtures instead and the checklist says what to install.
6. `--cohort-10k`: checks the release's `SHA256SUMS` against the pinned archive hash, downloads `synthea-v4-seed42-10k-fhir.tar.zst` (925,850,184 bytes) to `.synthea/downloads/` (kept for re-runs), checks its sha256, unpacks with zstd (about 41 GB), checks 11,551 files and the release's content checksum, ingests as `synthea-v4-seed42-10k` (rejected bundles are counted, not fatal), then deletes the unpacked files. Refused with less than 45 GB free.
7. Writes the Data page Training tab's sample with `bun run training:sample`: the training generator (`scripts/training-data/build-conversations.ts`, `docs/training-data.md`) on the first 12 subjects of `synthea-v4-seed42` with `--allow-eval-cohort`, through the real, audited query tools (actor `training-conversations`), to `training-data/out/sample-synthea-v4-seed42.jsonl` with its meta, manifest and stats files (gitignored). It is for looking at, never for training: the Training tab says so for any set from the evaluation cohort. Only with `DATA_MODE=synthetic`, and only when the pinned evaluation cohort is in the warehouse or this run loads it; skipped when the manifest is there; `--skip-training-sample` leaves it out. `bun run doctor` lists the sets it finds.
8. Adds one thread, "Example (synthetic)", to Your threads for `LOCAL_USER_ID`: a heart-rate chart question for 2024 to 2025 about evaluation-cohort subject `ba419d35-0dfe-8af7-347c-eebf02485a56` (one of the pinned 37), answered by `qwen3:4b`, with its chart and tool cards. It comes from `scripts/setup/fixtures/example-thread.json`, the stored answer of one real local run on 28 Oct 2026 against a database holding only the pinned cohort, so no model is called. qwen3 sometimes thinks out loud before its answer; the stored text keeps that, and the thread shows only the answer. Only with `LOCAL_MVP` or `AUTH_DISABLED` and `DATA_MODE=synthetic`. Before inserting, setup checks the fixture: no wearable keys or attribution, only warehouse and chart tools, the one synthetic subject, and tool outputs that still match their hashes. Skipped when the thread exists; `--skip-example` leaves it out. `bun run doctor` shows whether it is there.
9. Prints a checklist: `[ready]`, `[skipped]` with the reason and fix, `[off]` for `--skip-cohort`, `--skip-example` or `--skip-training-sample`, `[stale]` with the fix, `[FAILED]`. Exit 1 only when a step failed.

`bun run doctor` also lists what the Data page reads: `DATA_MODE`, then every cohort in `subjects` with whether it is in `SYNTHETIC_COHORTS` (`packages/query-tools/scope.ts`), how many of its subjects are `is_synthetic`, whether it has observation rows, and whether the evaluation cohort is stale. The page lists a cohort only when none of those says `[no]`.

The three trimmed open-twin fixtures (`tests/fixtures/synthea/patient-1.json` to `patient-3.json`) are people of the evaluation cohort, and a subject belongs to one cohort, so the cohort ingested second would have those bundles rejected (`subject-cohort-conflict`). Setup therefore never has both: the fixtures are loaded only into an empty warehouse, and a load or `--reload-cohort` of `synthea-v4-seed42` first deletes `open-twin-synthea-trimmed-3`'s rows in one transaction, the same way a reload deletes its own (the checklist note says so). The evaluation cohort's subject ids are listed in `scripts/setup/eval-cohort-subjects.ts`. Ingesting the fixtures by hand with `warehouse:ingest` next to the evaluation cohort still rejects those three bundles.

macOS (Homebrew): `brew install postgresql@18 pgvector openjdk@21 uv zstd`, `brew services start postgresql@18`, and put `$(brew --prefix openjdk@21)/bin` on PATH (openjdk@21 is keg-only). If the migration cannot create the `vector` extension, `brew info pgvector` says which Homebrew Postgres versions it is built for. Debian/Ubuntu: `sudo apt install postgresql postgresql-<major>-pgvector openjdk-21-jre-headless zstd` (pgvector from the PGDG repository) and uv from its install script.

- Good: a second run marks every step `[ready]` with "already …" reasons and ends "Everything is ready." `bun run doctor` lists every page `[ready]`.
- Last run: 2026-10-26 CET, Linux, against a new database `twin_llm_setup_test` on 127.0.0.1:5432 (dropped afterwards). `--skip-cohort` from a fresh worktree: created `.env.local` and the database, synced open-twin, installed, migrated, fetched 5 anatomy files, baked both rigged bodies; `/data` showed "No synthetic cohort loaded on this machine". Then `bun run setup:local`: generated the eval cohort (37 files, checksum as pinned; the same with `TZ=America/New_York`), `Bundles: 37 inserted, 0 already ingested, 0 rejected`; `/data` showed the cohort with 37 subjects. Third run: everything skipped. `--cohort-10k` was not run end to end (unit-tested planning only).
- Last run of `--reload-cohort`: 2026-10-26, Linux, throwaway database `twin_llm_reload_test` (dropped afterwards), seeded with 35 of the 37 pinned files as `synthea-v4-seed42` and 3 unrelated bundles as `synthea-v4-seed9001`. `bun run doctor` and `bun run setup:local` showed `[stale]` (35 subjects, bundles not the pinned files). `--reload-cohort`: deleted 35 subjects, 35 bundles, 35,337 observations and 8,965 non-numeric observations, ingested 37 bundles; the SQL fingerprint then equalled the pin, and `synthea-v4-seed9001` had the same 3 subjects, 3 bundles, 1,229 observations and bundle fingerprint as before. A plain run afterwards skipped the cohort. Deleting the local rigged bodies and running setup downloaded both from the release with the pinned SHA-256.
- Conditions and medication requests (#127): on an existing machine, `bun run setup:local` applies the migration (`prisma migrate deploy`) and then marks `synthea-v4-seed42` `[stale]` ("ingested before conditions and medication requests were stored"), because `warehouse:ingest` skips bundles it already has; `bun run setup:local -- --reload-cohort` fixes it. Another database (`.env.eval`, `.env.training`) needs `DATABASE_URL=<that url> bunx prisma migrate deploy`; its evaluation cohort then reloads the same way, and other cohorts get conditions only when their bundles are deleted and ingested again (there is no reload for them). Last run: 2026-10-27, Linux, throwaway database `twin_llm_scratch_clinical` (dropped afterwards): migrate deploy, release `eval-cohort-v1` ingested (37 bundles, 1,995 conditions, 3,615 medication requests), a second ingest skipped all 37; with the clinical rows deleted by hand the probe said stale with that reason, and the reload delete on the full cohort removed 37 subjects, 37 bundles, 35,598 observations, 9,022 non-numeric observations, 1,995 conditions and 3,615 medication requests.
- Last run of the evaluation cohort download: 2026-10-26, Linux x86_64, throwaway database `twin_llm_evaldl_test` (dropped afterwards), before release `eval-cohort-v1` existed. `bun run setup:local` printed "release eval-cohort-v1 with eval-cohort-synthea-v4-seed42-20260101.tar.zst is not published yet; generating synthea-v4-seed42 locally with Synthea instead.", generated 37 files with the pinned checksum and ingested 37. Then, with the archive copied into `.synthea/downloads/` and `.synthea/fhir` removed, `--reload-cohort` used the kept archive (SHA-256 as pinned), put 37 files with the pinned checksum in `.synthea/fhir`, deleted 37 subjects and ingested 37 bundles. The download from GitHub itself is unit-tested only until the release is published.

### Owner-only Postgres

Added 2026-10-30 (#144). Personal mode (`DATA_MODE=personal`, the default) does not start unless the database and files are open to your OS user only ([privacy-design.md](privacy-design.md#21-144-harden-local-storage-against-other-programs)). The recommended setup is a cluster of your own in the state directory (`TWINLLM_STATE_DIR`, default `${XDG_DATA_HOME:-$HOME/.local/share}/twin-llm` on Linux and `$HOME/Library/Application Support/TwinLLM` on macOS), with no TCP port. `scripts/setup/owner-cluster.ts`.

```sh
bun run setup:local -- --owner-cluster        # alone; other flags are refused with it
TWINLLM_PG_BIN=/path/to/postgres/bin bun run setup:local -- --owner-cluster   # when initdb is not on PATH or pg_config
bun run lab:storage                           # the startup checks by hand; exit 0 OK, 1 Not OK, 2 Unknown
bun run doctor                                # the same under "Local storage"
```

1. Finds `initdb` and `pg_ctl`: `TWINLLM_PG_BIN`, else `pg_config --bindir`, else `PATH`. On Debian and Ubuntu they are in `/usr/lib/postgresql/<major>/bin`.
2. Creates the state folder and `pg-socket` in it, mode 700. Stops if the socket path would be longer than the OS allows (103 bytes).
3. `initdb` into `$TWINLLM_STATE_DIR/pg` with a setup-only superuser `twinllm_admin`, `scram-sha-256` on the socket and `reject` on TCP, then appends `listen_addresses = ''`, the socket folder, `unix_socket_permissions = 0700` and statement logging off to its `postgresql.conf`. The two passwords (32 random bytes each) go to `$TWINLLM_STATE_DIR/owner-cluster.env`, mode 600, before initdb runs; they are never printed. A cluster already there is reused only if this command made it; a folder holding anything else is left alone and the step is blocked.
4. Starts it with `pg_ctl` (log in `pg/server.log`), creates the role `twinllm` (not a superuser) and the database `twin_llm` it owns, revokes `CONNECT` from `PUBLIC`, adds pgvector as the admin, and runs `prisma migrate deploy` against it.
5. Prints a command that replaces the `DATABASE_URL` line of `.env.local` with the one in `owner-cluster.env` without printing it (an existing `.env.local` is never edited by setup itself), and the `pg_ctl ... start` line for after a reboot. Running the command again also starts a stopped cluster.

The URL has the form `postgresql://twinllm:<password>@localhost/twin_llm?host=<socket folder, URL-encoded>`; the `host` parameter makes node-postgres, Prisma and `psql` use the socket.

**An existing shared Postgres** (Homebrew, apt, Docker) is accepted when `listen_addresses` is loopback only, the app connects as a role of its own that is not a superuser, with a password, and `pg_hba.conf` has no `trust` line for it. As a superuser on that server, after the backup in step 1 below (the password is yours to choose; keep it only in `.env.local`):

```sql
CREATE ROLE twinllm LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '<new password>';
CREATE DATABASE twin_llm OWNER twinllm;
REVOKE CONNECT ON DATABASE twin_llm FROM PUBLIC;
\c twin_llm
CREATE EXTENSION vector;
```

Then restore the backup into it as that superuser with `pg_restore --no-owner --no-acl --role=twinllm -d twin_llm "$DUMP"`, so the tables belong to `twinllm`, and set `DATABASE_URL=postgresql://twinllm:<new password>@127.0.0.1:5432/twin_llm`. Moving the old tables with `REASSIGN OWNED` does not work when they belong to the bootstrap superuser `postgres`.

```text
# pg_hba.conf, above any broader line; then reload Postgres
host  twin_llm  twinllm  127.0.0.1/32  scram-sha-256
host  twin_llm  twinllm  ::1/128       scram-sha-256
```

Setup never edits these system files. Docker's `-p 5432:5432` listens on every interface; publish on `127.0.0.1` only.

**Moving to the owner cluster from a shared Postgres.** Back up first; the backup holds your data in plain text, so it stays in the owner-only state folder.

```sh
# 0. Stop the app. Read the settings without printing them.
OLD_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d "\"'")"
: "${TWINLLM_STATE_DIR:=${XDG_DATA_HOME:-$HOME/.local/share}/twin-llm}"
# 1. Backup, owner-only, and its hash
mkdir -p -m 700 "$TWINLLM_STATE_DIR/backups"
DUMP="$TWINLLM_STATE_DIR/backups/pre-owner-cluster-$(date +%F).dump"
(umask 077 && pg_dump -Fc -d "$OLD_URL" -f "$DUMP") && sha256sum "$DUMP"
# 2. The cluster
bun run setup:local -- --owner-cluster
# 3. Replace its new, empty database with the backup, as the setup-only admin; objects end up owned by twinllm
ADMIN_PW="$(grep -m1 '^TWINLLM_PG_ADMIN_PASSWORD=' "$TWINLLM_STATE_DIR/owner-cluster.env" | cut -d= -f2-)"
SOCK="$TWINLLM_STATE_DIR/pg-socket"
PGPASSWORD="$ADMIN_PW" psql -h "$SOCK" -U twinllm_admin -d postgres -c 'drop database twin_llm' -c 'create database twin_llm owner twinllm' -c 'revoke all on database twin_llm from public'
PGPASSWORD="$ADMIN_PW" psql -h "$SOCK" -U twinllm_admin -d twin_llm -c 'create extension vector'
PGPASSWORD="$ADMIN_PW" pg_restore -h "$SOCK" -U twinllm_admin -d twin_llm --no-owner --no-acl --role=twinllm "$DUMP"
# 4. Point .env.local at the cluster with the command step 2 printed, then
bun run lab:storage
```

`pg_restore` reports one ignored error, `must be owner of extension vector` (the extension's comment); that is expected. Keep the backup until the app runs on the new cluster, then delete it (`rm "$DUMP"`), and drop the old database on the shared server when you no longer need it.

- Good: `bun run lab:storage` prints every line `[ok]`, exit 0. With `DATA_MODE=personal`, a start with `.env.local` at mode 644 answers 500 and logs `TwinLLM did not start: ... .env.local: mode 644; needs mode 600 or narrower ... Fix: chmod 600 .env.local`.
- Last run: 2026-10-30, Linux, Postgres 18.6 and pgvector from the maintainers' local Postgres build, with `TWINLLM_STATE_DIR` set to a throwaway folder whose name has a space (deleted afterwards). Created the cluster (socket and folders 700, no TCP listener, role not a superuser), applied all migrations, a second run said "already there" for every step. `bun run lab:storage` OK on all ten lines, including the sign-in without a password (refused); against a scratch cluster with `trust` the same probe was accepted. `next start` in personal mode against it served `/lab` with the card OK, the server's umask was 0077, and the synthetic lab-results fixture imported (9 rows) as the non-superuser role. With `.env.local` at 644 it refused as above. In synthetic mode connected as the superuser it started with one `[storage]` warning and the card Not OK on "Database role". The backup and restore steps above, run on that cluster's own database: 1 dataset and 9 observations back, tables owned by `twinllm`, `migrate deploy` had nothing to apply.

### Local unlock

Added 2026-10-31 (#142). In personal mode every personal page, route and server action waits for a passphrase ([privacy-design.md](privacy-design.md#22-142-local-unlock-before-personal-data-can-be-read)). Nothing to run: the first personal page asks for a passphrase (at least 12 characters) and then shows a recovery code once. Synthetic mode has no passphrase.

- **Where the key lives.** `$TWINLLM_STATE_DIR/vault/<hash of the user id>.json`, mode 600 in a 700 folder, checked at startup with the rest of the state folder (#144). It holds the KDF name, parameters and salts and the data key wrapped twice (under the passphrase and under the recovery code); nothing in it opens without one of the two. The open data key is only in the server's memory. Back the file up with the database: a dump without it cannot be decrypted once #141 encrypts rows.
- **Locking.** The Lock button at the foot of the sidebar, `VAULT_IDLE_LOCK_MINUTES` (default 15, 1 to 240) without a personal request, and every restart of the server. A locked route answers 423 with `{"error": "Your data is locked. Unlock it to continue.", "code": "PERSONAL_DATA_LOCKED"}` (`PERSONAL_DATA_NOT_SET_UP` before the first passphrase).
- **Wrong passphrase.** Each wrong try doubles the wait before the next one, from 1 s to 60 s (429 with `Retry-After`); the count lives in memory and resets with the server.
- **Forgot the passphrase.** "Forgot your passphrase?" on the unlock form takes the recovery code and a new passphrase, and shows a new recovery code; the old code stops working. Without either, the data key cannot be opened; the rows can still be deleted (drop the database, or `DELETE` as the admin), and deleting the vault file starts over with a new key.
- **"The key file could not be read."** The file exists but is not a vault record (edited, cut short, or wrong owner). The server never takes that for "no vault"; restore the file from a backup.
- **Audit rows.** `vault.setup`, `vault.unlock`, `vault.unlock.refused` (row count = wrong tries in a row), `vault.lock.manual`, `vault.lock.idle`, `vault.recovery_used`, `vault.recovery.refused`. Ids and counts only.
- Last run: 2026-10-31, Linux, `next start` in personal mode against a throwaway owner cluster (`TWINLLM_STATE_DIR` a new folder, deleted afterwards) with the synthetic lab-results fixture imported (9 rows). First visit to Customize · Data showed the setup form; after setup the recovery code; then the data page with Lock in the sidebar. Lock showed the unlock form and `/api/wearables/summary` answered 423; a wrong passphrase was refused with its sentence; the right one unlocked. The recovery code through `/api/vault/recover` set a new passphrase and the same code a second time was refused. A restart with the old cookie answered `locked` and 423. The audit table held one row per event as listed above, and the vault file was 600 in a 700 folder. Screenshots in light and dark.

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

Runs `scripts/synthea/generate-local.sh`. Java 21+, Synthea `v4.0.0` JAR checksum `ed43c20ad40ba5c3bc724503a5af032715fe3c491620b766148e7c2361e6ecc1`, seed `42`, clinician seed `43`, reference and end date `20260101` (Java in UTC, one generator thread; see `docs/warehouse.md`, "Reproducible runs"). `SYNTHEA_POPULATION` defaults to 10. Writes only under `.synthea/` (gitignored).

```sh
bun run synthea:generate -- --preset eval
```

- Good: prints `manifest.json` with `syntheaVersion: "v4.0.0"`, `seed: 42`, `age`, `referenceDate` and `endDate` `20260101`, `threadPoolSize: 1` and `contentSha256`. A second run gives the same `contentSha256`. `patientFileCount` can be above N because deceased patients are exported too. `.synthea/` is not committed.
- Last run: 2026-10-26, dates fixed, N=30, age 40-75 → 37 files, 245 MB, `contentSha256` `f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb` (OpenJDK 21.0.12.1). A second run in another folder under `TZ=America/New_York` gave the same checksum. The 2026-10-15 run, before the dates were fixed, gave 35 files.

### Seed the synthetic warehouse

Added 2026-10-15. Generate, ingest, then check counts. Synthetic rows only; it writes to whatever `DATABASE_URL` points at (the local dev database). `bun run setup:local` runs these steps (and checks the checksum) when the warehouse is empty; this is the manual path.

```sh
bun run synthea:generate -- --preset eval
bun run warehouse:ingest .synthea/fhir --cohort synthea-v4-seed42
bun run warehouse:ingest .synthea/fhir --cohort synthea-v4-seed42   # second run: all skipped
```

- Good: first run `Bundles: <patientFileCount> inserted, 0 already ingested, 0 rejected`, `Cohort synthea-v4-seed42: <patientFileCount> subjects`, and per-LOINC rows including `8480-6`, `8462-4`, `8867-4`, `29463-7`, `4548-4`. Second run `0 inserted, <patientFileCount> already ingested, 0 rejected`.
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

### Synthetic cohort explorer (`/customize/data/cohort`, formerly `/data`)

Added 2026-10-24. Customize · Data · Synthetic cohort shows the synthetic cohorts, their subjects and the training conversations, in any `DATA_MODE` (2026-10-26: personal mode too; the chat still reads no synthetic subject in personal mode).

```sh
bun run dev -p 3012
# optional, for the Training data tab (smoke set; never train on the evaluation cohort):
bun run training:conversations -- --cohort synthea-v4-seed42 --allow-eval-cohort \
  --max-subjects 12 --out training-data/out/smoke-seed42.jsonl
```

- Good: `/customize/data/cohort` shows the cohort picker, six tiles, the most common LOINC codes as a share of subjects, observations per year and the coverage bands. `/data/subjects` sorts and pages; a subject opens with a chart per code and unit and a latest-values table. `/data/training` lists the set with counts per family and outcome, and a conversation shows its tool calls and results.
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

- Good: migrations applied, empty diff or only the unmodelable HNSW `DROP INDEX`, pgvector probes hold, `verify-source-filter OK` (pgvector 0.8+, HNSW plan, 1 to 3 knowledge rows, usually 3/3, and 3 guideline rows over 5000 guideline chunks, each of the requested source), oura INSERT rejected by observations_source_synthea, synthea INSERT + ROLLBACK ok, audit chain ok then tamper breaks verifyChain at seq 1, verify-migrations OK.
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

### Specialty literature

Fetches open-licence PMC articles for one agent specialty into gitignored
`data/literature/<specialty>/`, then embeds them with
`source = 'literature:<specialty>'`. Licences and limits: `docs/literature.md`.

```sh
bun run literature:fetch -- --specialty diet --limit 3 --dry-run
bun run literature:fetch -- --specialty diet --limit 50
bun run literature:ingest -- --specialty diet
```

- Good: one `stored` or `skipped <reason>` line per article, then
  `searched=<n> stored=<n> skipped=<n>`. A re-run skips what is stored.
- Last fetch: 2026-10-28, `--specialty diet --limit 3`: three stored (one
  CC BY, two CC BY-NC-ND), none skipped. The ingest has only run against
  test fakes so far, not a database.

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

Mocked spawn fixtures (CLI 0.5.0 shapes) for `ok`, `locked`, `unpaired`, `busy`, `refused`,
`awaiting_approval`, `undelivered`, `outdated`, `rejected`, `app_failed` and `error`. `RUN_ARK` is unset, so the live device test
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

- Good: `ark:test` prints cargo 8 + 4 passed, then `wasmtime two-pass goldens ok`
  when the WASI toolchain is installed. Local Homebrew rustc 1.98 without
  `wasm32-wasip1` still runs the host goldens and skips the wasmtime pass.
- Last run: 2026-09-28 11:05 CEST, host `cargo test --locked` 6 passed / 0
  failed (wasmtime not on PATH; wasm-opt not installed).

### `RUN_ARK=1` (local Ark or emulator only; never CI)

Calls `status`, `data list`, and `data paths` against `ARK_DEVICE`, then one
`appRun` (`ark run`) of `rsid-genotypes.wasm`. Asserts the six slot names, that every
path starts with `v1/genome`, and that the app report has eleven rsID lines
plus the research-use footer. Close Hub first. Build the wasm first. Does
not pass `--unlock`. Approve the run, switch on all eleven sites, then release the
report in Companion (5 and 10 minute windows). The test does not print
the report.

```sh
bun run ark:build
GENOME_SOURCE=ark RUN_ARK=1 ARK_DEVICE=alpha-002 bun test packages/ark-adapter
```

- Good: one device, six named slots, every path under `v1/genome`, appRun
  `ok` after both phone steps, eleven TSV rows, footer present.
- Last run: not a CI gate; local optional after `ark:build` and Companion
  approval. Confirm panel rsIDs are `available` with `ark data paths --json`
  first (read-only).
