# Warehouse

Local research store for a Synthea cohort. Numeric rows come from `@open-twin/fhir-r4` `normaliseBundle` at pin `24179d8`. Personal wearable snapshots (Oura, Whoop, Google Health) and the files a person imports on Customize · Data ([personal-data.md](personal-data.md)) never write these tables.

## Pin

- open-twin `24179d8de0e38ca579adde55db65d13926ac6bac`
- Host dep: `@open-twin/fhir-r4` via `file:.open-twin/packages/fhir-r4`
- Sync: `bash scripts/sync-open-twin.sh` (see `docs/open-twin-pins.md`)

## Schema

| Table                     | Role                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `subjects`                | Opaque `subject_ref` PK, `is_synthetic` (always true here), `cohort_id`, `sex`, `birth_year`, `death_year` |
| `bundles`                 | `sha` PK (sha256 of raw bytes), `cohort_id`, `ingested_at`, `synthea_version`                              |
| `observations`            | Numeric row, `unit_ucum` NOT NULL, `UNIQUE(bundle_sha, fhir_id)`                                           |
| `observation_non_numeric` | String / codeable / boolean payloads as `raw_value` jsonb                                                  |
| `conditions`              | Synthea Condition as recorded, `UNIQUE(bundle_sha, fhir_id)`                                               |
| `medication_requests`     | Synthea MedicationRequest as recorded, `UNIQUE(bundle_sha, fhir_id)`                                       |

`ingestBundle` does not take `is_synthetic` from the caller. It hard-sets `isSynthetic: true` and `source: "synthea"`. Snapshot tables have no `is_synthetic` column, so a personal connector row cannot be stored as synthetic.

The tables come from `prisma/migrations/20261025000000_baseline`, which also adds `CHECK (source = 'synthea')` on both observation tables by hand. `conditions` and `medication_requests` come from `20261027130000_conditions_medication_requests`, with the same check. They have no `is_synthetic` column: a row is synthetic through its subject (`subjects.is_synthetic`), which every read checks.

### Conditions and medication requests

Copied from the normalised bundle as recorded; nothing is inferred, and a missing date or status stays null (`packages/warehouse/map-clinical.ts`).

- `conditions`: `code_system`, `code`, `display` (SNOMED CT or ICD-10 in Synthea v4), `onset_at` and `abatement_at` (`onsetDateTime`, `abatementDateTime`), `clinical_status`, `verification_status`, `encounter_ref`.
- `medication_requests`: `code_system`, `code`, `display` from `medicationCodeableConcept`, or from the `code` of the Medication that `medicationReference` points at in the same bundle (Synthea uses both; RxNorm wins over any other coding; an unresolved reference leaves the code empty). `authored_at`, `status`, `intent`, `dosage_text` (each `dosageInstruction[].text`, verbatim; no dose, timing or route fields are kept) and `reason_refs` (`reasonReference[].reference`).
- References (`encounter_ref`, `reason_refs`) carry the ids `normaliseBundle` assigned, so a reason ref is `urn:uuid:<fhir_id>` of a condition from the same bundle.

### Sex, birth year and death year (#4)

`prisma/migrations/20261027150000_subject_sex_birth_year` adds three nullable columns to `subjects`: `sex` (FHIR `Patient.gender`: `female`, `male`, `other` or `unknown`), `birth_year` (the year of `Patient.birthDate`) and `death_year` (the year of `Patient.deceasedDateTime`). Only years are stored, never a full date; the year is read as written in the bundle, not shifted by a time zone. Three checks hold them in the database: `sex` is one of the four values, a death year is not before the birth year, and all three stay null unless `is_synthetic` is true.

`ingestBundle` fills them from the bundle's Patient (`packages/warehouse/subject-facts.ts`), after the Synthea marker check, so they are only ever written for synthetic subjects; personal wearable data never reaches `subjects`. A fact the Patient does not carry is left as it is rather than set to null, so a synthetic wearable bundle (it copies only the Patient's id and identifier) never erases what the subject's own Synthea bundle stored. A `deceasedBoolean` without a date gives no death year.

Rows ingested before the migration keep null facts until they are filled in. Either of these does it:

- `bun run warehouse:ingest <dir> --cohort <id>` again over the same files: an `already ingested` bundle writes no observation, but its subject's sex, birth year and death year are updated.
- `bun run setup:local -- --reload-cohort` for the evaluation cohort: it deletes that cohort's warehouse rows and ingests the pinned files.

## ingestBundle

`packages/warehouse/ingest-bundle.ts`:

1. The bundle's Patient must carry the Synthea identifier system. Otherwise → `rejected.reason = not-synthea`, nothing written. Library callers cannot skip this.
2. Hash the raw bundle. A known `bundles.sha` returns `{ inserted: 0, skipped: <observation rows>, conditions, medicationRequests, alreadyIngested: true }` with the stored counts; the only write is the subject's sex, birth year and death year from the Patient (the backfill above).
3. Call `normaliseBundle` with `unresolvedUrnPolicy: "preserve"`. If there is no `bundle`, return `{ inserted: 0, rejected: { reason } }` and list dangling `urn:uuid:` refs in `unresolved`. Do not insert `bundles` on reject.
4. Map Observations (`mapObservations`). Every numeric row needs a UCUM `code`. Missing unit → `rejected.reason = ot-quantity-no-code`. Missing is not written as zero.
5. Components with a LOINC code and a Quantity become their own numeric rows. A blood pressure panel (`85354-9`) gives one `8480-6` (systolic) and one `8462-4` (diastolic) row, with `fhir_id = <panel id>#<component loinc>` and the panel's time. A LOINC that repeats within one panel gets `/2`, `/3`, … from its second occurrence, in source order. The panel itself stays in `observation_non_numeric` as `value_type = components`.
6. Map Conditions and MedicationRequests (`mapConditions`, `mapMedicationRequests`).
7. One transaction (timeout 120 s): first look up the subject. If it already belongs to another cohort, write nothing and reject (`subject-cohort-conflict`). A subject never moves between cohorts. Otherwise upsert the subject with its sex, birth year and death year and insert observations, conditions and medication requests with `createMany`, so a full Synthea patient with thousands of rows fits. A bundle is written whole or not at all.
8. Report: `{ inserted, skipped, unresolved, nonNumeric, conditions, medicationRequests, alreadyIngested, rejected? }` (Zod). `inserted` and `skipped` count observation rows.

## Cohorts and scope

`SYNTHETIC_COHORTS` in `packages/query-tools/scope.ts` is the allowlist:

| Cohort                         | What                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `open-twin-synthea-trimmed-3`  | The three trimmed open-twin fixtures (tests)                                         |
| `synthea-v4-seed42`            | Generated locally: Synthea v4.0.0, seed 42, N=30, ages 40–75                         |
| `synthea-v4-seed4242`          | Training cohort, seed 4242, N=10,000 (`--preset training`)                           |
| `synthea-v4-seed9001`          | Held-out cohort, seed 9001, N=1,000 (`--preset held-out`)                            |
| `synthea-v4-seed42-10k`        | 10,000 living people (11,551 records) from release `cohort-synthea-v4-seed42-10k`    |
| `synthea-v4-seed1001` … `1100` | The 1M cohort, one cohort per batch of 10,000 (`training:batches`; 1100 is held out) |

The Body twin's Demo lists only `DEMO_COHORTS` (`open-twin-synthea-trimmed-3`, `synthea-v4-seed42`), never the training or held-out cohorts, the 1M batches or the 10k release cohort. The batch ids are generated in `scope.ts` (`SYNTHEA_1M_COHORTS`), not written out.

A query tool serves a subject only when `DATA_MODE=synthetic`, the row has `is_synthetic = true`, and its `cohort_id` is in the list. Anything else returns `SUBJECT_SCOPE_VIOLATION`. A new cohort label needs a code change, which is reviewed in a PR.

The Body twin's Demo lab values (`/api/biomarkers/cohort`, see `docs/biomarkers.md`) read the warehouse under the same rule and are audited the same way.

## Data page

`/customize/data/cohort` (Customize · Data, formerly `/data`; `features/data-explorer/`) is where the team looks at what is in the warehouse. It is labelled "Synthetic data" and reads only `is_synthetic` subjects of a cohort in `SYNTHETIC_COHORTS`, in any `DATA_MODE`.

### Synthetic display scope

The Data page and the Body twin's Demo lab values read through the synthetic display scope (`packages/query-tools/synthetic-display.ts`), not the chat's `SessionScope`. These screens show synthetic people to the person at the screen and send nothing to a model, so a personal-mode machine (one with its own Oura or Whoop) shows them too. The display scope takes no mode: its Prisma filters (`DISPLAY_SUBJECT_WHERE`, `DEMO_SUBJECT_WHERE`) and row checks select only `is_synthetic` rows of allowlisted cohorts (Demo cohorts for the Demo), and nothing can widen them. Every read is still audited.

The chat stays strict. The query tools and `show_view` use `scope.ts`, which in personal mode refuses every synthetic subject; the chat tools never import the display scope. `synthetic-display.test.ts` checks both sides.

- **Overview**: per cohort, subjects, numeric and text observations, distinct LOINC codes and the years covered; subjects by sex and 10-year age band, with counts (`sex-age-split.ts`; ages are the age reached in the year of the cohort's latest reading, or in the year of death, from the birth year only, so they can be a year high; subjects with no stored facts are counted as not stored); the most common codes with their units as a share of subjects; observations per year; and coverage (how many codes reach how many subjects, the codes at least 80% have and the sparse ones under 10%). Codes stored in more than one unit are listed.
- **Subjects**: subject_refs with observation and code counts, first and last day; search, sort and pages are URL parameters. The database does all three: the search is a case-insensitive subject_ref prefix (`%`, `_` and `\` match themselves), the sort is one of five fixed columns (ties by subject_ref, subjects with no rows last), and only the 25 rows of the page are read (LIMIT/OFFSET; a page past the end shows the last one). A subject page has one chart per code and unit (units are never converted) and a table of latest values, readings, days with data, first and last day.
- **Audit**: every read writes an audit row, refusals and failed reads included: `data-explorer.cohort.overview` and `data-explorer.cohort.subjects` with no subject_ref, `data-explorer.subject.observations` with the subject_ref and the rows read. The overview's `row_count` is the number of observations its counts summarise, not rows returned; the subject list's args hold the search, sort, direction and page, and its `row_count` is the rows on that page. A cohort off the allowlist is audited as `SUBJECT_SCOPE_VIOLATION` with 0 rows. A subject with more than 50,000 numeric rows is refused (`ROW_CAP_EXCEEDED`, 0 rows) rather than cut, since a cut read would lose the newest values.
- **Sign-in**: with sign-in on, every tab, Training data included, needs a signed-in actor.
- The cohort summaries are fixed `$queryRaw` statements with the cohort id bound (Prisma `groupBy` has no distinct-subjects count); the counts per code and unit and per code come from one statement (`GROUPING SETS`). The subjects table counts and pages with Prisma (`count`, `findMany` with `skip`/`take`, `groupBy` for the page's counts) when sorted by subject_ref; sorted by a count or a day, the page's 25 subject_refs come from one fixed `$queryRaw` whose ORDER BY comes from a closed list in `features/data-explorer/cohort-queries.ts`, with cohort, search and window bound, and their counts from the same `groupBy`. The subject read is a `findMany`. They are the first `$queryRaw` outside vector search (`docs/query-layer.md`).
- Overview and subject-table results are cached in the server process per cohort and request, for at most 5 minutes and only while the cohort's fingerprint (its bundle count, latest `ingested_at` and subjects with a birth year, read on every request) is unchanged, so an ingest or a cleared cohort shows at once. Every request still writes its audit row. `RUN_LIVE=1 DATABASE_URL=<throwaway> bun test features/data-explorer/cohort-queries.live.test.ts` checks the queries against Postgres.
- Timing (#3), 2026-10-27, Linux, 8 cores shared with other jobs (load average 13–20), a throwaway database holding batch `synthea-v4-seed1001` (11,380 subjects, 4,906,250 numeric rows), `next start`, `curl` three times each. `/data/subjects`, before (every subject's counts read, sorted and cut in memory): 11.7–12.5 s by observations, 12.3–14.2 s by subject_ref page 200, 6.6–9.1 s by last day page 100, 6.6–7.1 s with a search. After: first request 3.7 s, 0.11 s, 2.1 s and 0.11 s; repeated requests 35–110 ms (cached). The overview went from 9.5–10.1 s per request to about 17 s for the first one (cold server) and 0.09 s after; the one GROUPING SETS statement alone is not faster than the three it replaces (15.6 s against 13.6 s median outside the server), so the gain is the cache. The same pages and sorts returned the same rows before and after, except that a search now matches a prefix only.
- A chart draws at most 1,000 readings of a series: the lowest and highest of each stretch, exact values. The table counts every reading.
- The sex and age split is one Prisma `groupBy` over `sex`, `birth_year` and `death_year` for the cohort's `is_synthetic` subjects; it is part of the overview read and its audit row. A cohort ingested before the columns existed shows the not-stored row and how to fill it in.

## warehouse:ingest

`bun run warehouse:ingest <dir> [--cohort <id>] [--workers <n>]` (`scripts/warehouse/ingest.ts`). The default cohort is `synthea-v4-seed42`.

- Splits the `*.json` files in `<dir>` across `--workers` ingest processes (default: CPU cores − 1, at least 1; never more than files), dealt out in turn (`scripts/warehouse/ingest-shard.ts`, `ingest-worker.ts`). Each file is read and parsed once. Lines are printed as files finish, so their order varies between runs; the totals do not.
- A file that does not parse is rejected (`invalid-json`). Valid JSON that is not a FHIR Bundle is skipped.
- Every Bundle's Patient must carry the identifier system `https://github.com/synthetichealth/synthea`; `ingestBundle` rejects one that does not (`not-synthea`) and writes nothing of it. Since #5 there is no separate checking pass: a rejected file no longer stops the run before anything is written. The other files are ingested, the rejected ones are listed, and the exit code is 1. Re-running after a fix ingests only what is missing.
- The cohort must be in `SYNTHETIC_COHORTS`. Otherwise the run is refused.
- When `manifest.json` in `<dir>` or its parent names a `cohortId` (the generators write one), it must equal `--cohort` (or the default). A mismatch is refused before anything is written. With no cohort id there, the run goes on with a warning.
- `synthea_version` comes from `manifest.json` in `<dir>` or its parent (written by the generator), else the pinned `v4.0.0`.
- A bundle whose ingest throws is tried once more (two processes can meet on one subject or one bundle hash; the retry then finds the other's row), then reported as `rejected (ingest-failed)`, never with the raw error, and the run goes on to the next bundle and the summary. So is every file of a worker process that dies before reporting it; each bundle is written in one transaction or not at all.
- Prints one line per file (observation rows, conditions, medication requests), totals, the cohort's subject, condition and medication request counts, and numeric rows per LOINC. It prints no values. Exit code 1 on any rejected bundle.
- Safe to re-run: a bundle whose sha256 is already stored is reported as `already ingested` (from `alreadyIngested`, not from a zero insert count).

## Fixtures

Byte copies of the three open-twin trimmed bundles live under `tests/fixtures/synthea/`. `bp-panel.json` is a small hand-made bundle (two blood pressure panels and one HbA1c, two years apart) for the component path. `clinical/clinical-records.json` is hand-made too: two conditions (one resolved SNOMED, one active ICD-10) and two medication requests (one coded inline with dosage text, one through a Medication reference without), in a subfolder so `warehouse:ingest tests/fixtures/synthea` does not load it. Provenance: `tests/fixtures/synthea/PROVENANCE`. Generated bundles are never committed.

Those bundles carry Encounter URNs whose targets were removed. `ingestBundle` passes `unresolvedUrnPolicy: "preserve"`, so `normaliseBundle` returns a bundle, lists the dangling `urn:uuid:` refs in `unresolved`, and inserts five numeric rows per fixture. `preserve` does not mean the Encounter references resolved.

## Local generation

`bun run synthea:generate` runs `scripts/synthea/generate-local.sh`. Default seed `42`, clinician seed `43`, `N` 10, no age range. `--population`, `--seed` and `--age` (or `SYNTHEA_POPULATION`, `SYNTHEA_SEED`, `SYNTHEA_AGE`) change them; flags win over env. `--preset eval|training|held-out` sets all of them plus the output folder (`scripts/synthea/cohort-presets.ts`), and `--dry-run` prints the settings without running Java. Writes only to `.synthea/` (gitignored); `manifest.json` records the cohort id. Java 21+. JAR `v4.0.0` checksum is checked before run.

### Reproducible runs

The same seeds, dates, population, age range and Synthea version give the same patient files, byte for byte, in any folder and any time zone, on the same CPU architecture. Byte-identical generation holds per architecture, not across them (see "Other CPU architectures" below). The script does three things for that, as open-twin does since Opening-Science/open-twin#218:

- **Fixed dates.** Without them Synthea simulates up to the moment the run starts, so two runs of the same seed differ by however far apart they started. The script always passes `-r` (reference date) and `-e` (end date), both `20260101` by default and on every preset (`referenceDate` and `endDate` in `scripts/synthea/cohort-presets.ts`). `SYNTHEA_REFERENCE_DATE` and `SYNTHEA_END_DATE` (`YYYYMMDD`) change them; anything that is not a real calendar date is refused, since Synthea would quietly roll `20260230` over to 2 March. `--preset eval` refuses other dates, because the evaluation answer key is computed from that exact cohort.
- **UTC.** Synthea reads the dates in the JVM's time zone, so Java runs with `-Duser.timezone=UTC`.
- **One generator thread.** `generate.thread_pool_size = 1`: with more threads Synthea v4.0.0 has a race that changes a few fields between runs of the same seed. For large cohorts, run several cohorts in parallel instead.

`manifest.json` records `referenceDate`, `endDate`, `timezone`, `threadPoolSize`, `jarSha256`, `configSha256` (the generated `synthea.properties`), `javaVersion` and `contentSha256`, the checksum of the patient files. To compare two runs, or a run with a manifest:

```sh
cd .synthea/fhir && sha256sum *.json | LC_ALL=C sort | sha256sum
bun scripts/synthea/cohort-checksum.ts .synthea/fhir   # the same value, from TypeScript
```

`RUN_LIVE=1 bun test scripts/synthea/reproducible.live.test.ts` regenerates the evaluation cohort in a temporary folder under `TZ=America/New_York` and checks its checksum against `EVAL_CONTENT_SHA256` in `scripts/synthea/cohort-presets.ts` (Java 21+, a few minutes).

#### Other CPU architectures

On a Mac with Apple Silicon (arm64), with the same JAR, `configSha256` and Java 21.0.12.1, `--preset eval` gives the same 37 patients (names, ages, order) but `contentSha256` `825aa5fc17dbabe77bc4fe71dc20d5d249c3027d7266352c933b0ec5d484db5a` instead of the pin (#100). Synthea calls `java.lang.Math` (`exp`, `pow`, `log`), not `StrictMath`, and `Math` may differ in the last bit between JVM implementations: on x86_64 HotSpot uses Intel's libm routines for `Math.exp`/`pow`/`log`, on arm64 it does not. Checked on Linux x86_64 (OpenJDK 21.0.12.1, 2026-10-26):

| JVM flags                                                                                       | `contentSha256`                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| none                                                                                            | `f4941fab…` (the pin)                                              |
| `-XX:TieredStopAtLevel=1` (C1 only), `DisableIntrinsic=_dpow`, `DisableIntrinsic=_dlog,_dlog10` | `f4941fab…`                                                        |
| `-XX:+UnlockDiagnosticVMOptions -XX:-UseLibmIntrinsic`                                          | `fe8dbda0258983fa98a4b04d5d218a7919d3de61e1ad663517391574759ca8e9` |
| `-XX:+UnlockDiagnosticVMOptions -XX:DisableIntrinsic=_dexp`                                     | `fe8dbda0…`                                                        |

Without the libm `Math.exp` routine two of the 37 files change, each in the last digit of the disability- and quality-adjusted life years on the Patient (`QualityOfLifeModule.weight` uses `Math.exp`); no observation changes. Neither flag set gives the Mac's checksum, so no JVM flag makes the output the same on both architectures, and the recipe keeps its flags. Making it portable would mean running Synthea with `StrictMath`, which changes the files and so the pin and the answer key.

So the pinned files are published instead: release `eval-cohort-v1`, asset `eval-cohort-synthea-v4-seed42-20260101.tar.zst` (`fhir/` with the 37 bundles and the generator's `manifest.json`, made on Linux x86_64; 4,911,581 bytes, SHA-256 `45d84cad9882f9fe7365f42b7bc64b6cedcc6665a412c88a8e56e612712c2b14`, `EVAL_RELEASE` in `scripts/setup/cohort-pins.ts`). `bun run setup:local` downloads it by default, follows GitHub's redirect only to GitHub's asset hosts (as `anatomy:fetch` does), checks the archive's size and SHA-256 and the unpacked files' `contentSha256`, and only then replaces `.synthea/fhir`. `--generate-cohort` generates with Synthea instead; on arm64 a mismatch is reported as a platform difference with the download as the fix. While the release does not exist, setup says it is not published yet and generates.

Cohorts generated before the dates were fixed cannot be regenerated byte for byte; their manifests have no dates. That covers the training and held-out cohorts, the 10,000- and 1,000,000-patient sets, any `.synthea/` made before this change, and the evaluation cohort the first answer key (2026-10-20) was built from: 33 bundles, checksum `679420920567fc854452aed9375c0fd28f4429c94156ab8df9d18d4eb8902717`.

Synthetic wearable series for the training cohorts come from `bun run wearables:generate -- --in .synthea/<cohort>/fhir` (`scripts/synthetic-wearables/`): one bundle per living subject with that subject's Synthea Patient id, ingested with `warehouse:ingest` into the same cohort. They are added to `synthea-v4-seed42` only in the throwaway answer-key and eval databases (`--allow-eval-cohort`, `docs/evaluation/question-set.md`), never in the dev database; the series starts after that cohort's records end, so no earlier key value changes. Two things to know when reading them: daily heart rate (`8867-4`) and respiratory rate (`9279-1`) use the same LOINC codes as Synthea's clinic vitals, so a query on those codes returns both kinds of row; and every time is UTC (sleep, resting heart rate, HRV and respiration at 07:00, heart rate at 12:00, workouts at 18:00, steps at 23:00). `wearables:generate` refuses the evaluation cohort without `--allow-eval-cohort`.

### The `synthea-v4-seed42` cohort

```sh
bun run synthea:generate -- --preset eval
bun run warehouse:ingest .synthea/fhir --cohort synthea-v4-seed42
```

`bun run setup:local` downloads the pinned files (release `eval-cohort-v1`) and ingests them on an empty warehouse; with `--generate-cohort`, or when the release cannot be reached, it runs both commands above. Either way it refuses to ingest unless the files match `EVAL_CONTENT_SHA256` (37 files with fixed dates). A `synthea-v4-seed42` already in the warehouse that is not this cohort (35 subjects from before the dates were fixed, bundles whose fingerprint is not the pin, or the pinned bundles ingested before conditions and medication requests were stored) is reported `[stale]` by setup and `bun run doctor`; `bun run setup:local -- --reload-cohort` deletes that cohort's warehouse rows (observations, conditions, medication requests, bundles, subjects) in one transaction and ingests the pinned files. `bun run setup:local -- --cohort-10k` loads the release cohort `synthea-v4-seed42-10k` instead (docs/runbook.md, "Local setup").

N=30, ages 40–75, reference and end date `20260101`. Synthea exports deceased patients as well, so there are more bundles than N: 37 bundles, 37 subjects, 35,598 numeric observations, 9,022 non-numeric observations, 1,995 conditions (192 distinct codes, all 37 subjects; 532 active, 1,463 resolved; 45 coded in ICD-10, the rest SNOMED CT) and 3,615 medication requests (108 distinct RxNorm codes, 36 subjects; 167 active, 3,448 completed; 816 with dosage text; 2,936 with reason refs, all resolving to a stored condition) (`conditionCount`, `medicationRequestCount` in `scripts/setup/cohort-pins.ts`; measured 2026-10-27 from release `eval-cohort-v1` in a throwaway database), `contentSha256` `f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb` (`EVAL_CONTENT_SHA256` in `scripts/synthea/cohort-presets.ts`; generated 2026-10-26, the same in a second run under another time zone). The evaluation answer key records the same dates and checksum (`docs/evaluation/question-set.md`). These codes are the ones B3 and C2 rely on:

| LOINC     | What              |
| --------- | ----------------- |
| `8867-4`  | Heart rate        |
| `8480-6`  | Systolic BP       |
| `8462-4`  | Diastolic BP      |
| `29463-7` | Body weight       |
| `39156-5` | BMI               |
| `4548-4`  | HbA1c             |
| `2339-0`  | Glucose (blood)   |
| `2093-3`  | Total cholesterol |
| `18262-6` | LDL cholesterol   |
| `2085-9`  | HDL cholesterol   |
| `2571-8`  | Triglycerides     |

Each machine downloads (or, on x86_64, may generate) and ingests its own copy; `contentSha256` in `manifest.json` shows whether two copies are the same.
