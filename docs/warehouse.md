# Warehouse

Local research store for a Synthea cohort. Numeric rows come from `@open-twin/fhir-r4` `normaliseBundle` at pin `24179d8`. Personal wearable snapshots (Oura, Whoop, Google Health) never write these tables.

## Pin

- open-twin `24179d8de0e38ca579adde55db65d13926ac6bac`
- Host dep: `@open-twin/fhir-r4` via `file:.open-twin/packages/fhir-r4`
- Sync: `bash scripts/sync-open-twin.sh` (see `docs/open-twin-pins.md`)

## Schema

| Table                     | Role                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| `subjects`                | Opaque `subject_ref` PK, `is_synthetic` (always true here), `cohort_id`       |
| `bundles`                 | `sha` PK (sha256 of raw bytes), `cohort_id`, `ingested_at`, `synthea_version` |
| `observations`            | Numeric row, `unit_ucum` NOT NULL, `UNIQUE(bundle_sha, fhir_id)`              |
| `observation_non_numeric` | String / codeable / boolean payloads as `raw_value` jsonb                     |

`ingestBundle` does not take `is_synthetic` from the caller. It hard-sets `isSynthetic: true` and `source: "synthea"`. Snapshot tables have no `is_synthetic` column, so a personal connector row cannot be stored as synthetic.

The tables come from `prisma/migrations/20261025000000_baseline`, which also adds `CHECK (source = 'synthea')` on both observation tables by hand.

## ingestBundle

`packages/warehouse/ingest-bundle.ts`:

1. The bundle's Patient must carry the Synthea identifier system. Otherwise → `rejected.reason = not-synthea`, nothing written. Library callers cannot skip this.
2. Hash the raw bundle. A known `bundles.sha` returns `{ inserted: 0, skipped: <row count>, alreadyIngested: true }`.
3. Call `normaliseBundle` with `unresolvedUrnPolicy: "preserve"`. If there is no `bundle`, return `{ inserted: 0, rejected: { reason } }` and list dangling `urn:uuid:` refs in `unresolved`. Do not insert `bundles` on reject.
4. Map Observations (`mapObservations`). Every numeric row needs a UCUM `code`. Missing unit → `rejected.reason = ot-quantity-no-code`. Missing is not written as zero.
5. Components with a LOINC code and a Quantity become their own numeric rows. A blood pressure panel (`85354-9`) gives one `8480-6` (systolic) and one `8462-4` (diastolic) row, with `fhir_id = <panel id>#<component loinc>` and the panel's time. A LOINC that repeats within one panel gets `/2`, `/3`, … from its second occurrence, in source order. The panel itself stays in `observation_non_numeric` as `value_type = components`.
6. One transaction (timeout 120 s): first look up the subject. If it already belongs to another cohort, write nothing and reject (`subject-cohort-conflict`). A subject never moves between cohorts. Otherwise insert with `createMany`, so a full Synthea patient with thousands of rows fits.
7. Report: `{ inserted, skipped, unresolved, nonNumeric, alreadyIngested, rejected? }` (Zod).

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

`/data` (`features/data-explorer/`) is where the team looks at what is in the warehouse. It is labelled "Synthetic data" and reads only `is_synthetic` subjects of a cohort in `SYNTHETIC_COHORTS`, in any `DATA_MODE`.

### Synthetic display scope

The Data page and the Body twin's Demo lab values read through the synthetic display scope (`packages/query-tools/synthetic-display.ts`), not the chat's `SessionScope`. These screens show synthetic people to the person at the screen and send nothing to a model, so a personal-mode machine (one with its own Oura or Whoop) shows them too. The display scope takes no mode: its Prisma filters (`DISPLAY_SUBJECT_WHERE`, `DEMO_SUBJECT_WHERE`) and row checks select only `is_synthetic` rows of allowlisted cohorts (Demo cohorts for the Demo), and nothing can widen them. Every read is still audited.

The chat stays strict. The query tools and `show_view` use `scope.ts`, which in personal mode refuses every synthetic subject; the chat tools never import the display scope. `synthetic-display.test.ts` checks both sides.

- **Overview**: per cohort, subjects, numeric and text observations, distinct LOINC codes and the years covered; the most common codes with their units as a share of subjects; observations per year; and coverage (how many codes reach how many subjects, the codes at least 80% have and the sparse ones under 10%). Codes stored in more than one unit are listed.
- **Subjects**: subject_refs with observation and code counts, first and last day; search, sort and pages are URL parameters. A subject page has one chart per code and unit (units are never converted) and a table of latest values, readings, days with data, first and last day.
- **Audit**: every read writes an audit row, refusals and failed reads included: `data-explorer.cohort.overview` and `data-explorer.cohort.subjects` with no subject_ref, `data-explorer.subject.observations` with the subject_ref and the rows read. The overview's `row_count` is the number of observations its counts summarise, not rows returned. A cohort off the allowlist is audited as `SUBJECT_SCOPE_VIOLATION` with 0 rows. A subject with more than 50,000 numeric rows is refused (`ROW_CAP_EXCEEDED`, 0 rows) rather than cut, since a cut read would lose the newest values.
- **Sign-in**: with sign-in on, every tab, Training data included, needs a signed-in actor.
- The cohort summaries are fixed `$queryRaw` statements with the cohort id bound (Prisma `groupBy` has no distinct-subjects count); the subject read is a `findMany`. They are the first `$queryRaw` outside vector search (`docs/query-layer.md`).
- A chart draws at most 1,000 readings of a series: the lowest and highest of each stretch, exact values. The table counts every reading.
- Sex, birth year and death are not stored, so the page has no split by them.

## warehouse:ingest

`bun run warehouse:ingest <dir> [--cohort <id>]` (`scripts/warehouse/ingest.ts`). The default cohort is `synthea-v4-seed42`.

- Reads every `*.json` in `<dir>`. A file that does not parse is refused. Valid JSON that is not a FHIR Bundle is skipped.
- Every Bundle's Patient must carry the identifier system `https://github.com/synthetichealth/synthea`. If a file is refused (invalid JSON or not Synthea), the run lists it and stops before anything is written.
- The cohort must be in `SYNTHETIC_COHORTS`. Otherwise the run is refused.
- When `manifest.json` in `<dir>` or its parent names a `cohortId` (the generators write one), it must equal `--cohort` (or the default). A mismatch is refused before anything is written. With no cohort id there, the run goes on with a warning.
- `synthea_version` comes from `manifest.json` in `<dir>` or its parent (written by the generator), else the pinned `v4.0.0`.
- A bundle whose ingest throws is reported as `rejected (ingest-failed)`, never with the raw error, and the run goes on to the next bundle and the summary.
- Prints one line per file, totals, the cohort's subject count and numeric rows per LOINC. It prints no values. Exit code 1 on any rejected bundle.
- Safe to re-run: a bundle whose sha256 is already stored is reported as `already ingested` (from `alreadyIngested`, not from a zero insert count).

## Fixtures

Byte copies of the three open-twin trimmed bundles live under `tests/fixtures/synthea/`. `bp-panel.json` is a small hand-made bundle (two blood pressure panels and one HbA1c, two years apart) for the component path. Provenance: `tests/fixtures/synthea/PROVENANCE`. Generated bundles are never committed.

Those bundles carry Encounter URNs whose targets were removed. `ingestBundle` passes `unresolvedUrnPolicy: "preserve"`, so `normaliseBundle` returns a bundle, lists the dangling `urn:uuid:` refs in `unresolved`, and inserts five numeric rows per fixture. `preserve` does not mean the Encounter references resolved.

## Local generation

`bun run synthea:generate` runs `scripts/synthea/generate-local.sh`. Default seed `42`, clinician seed `43`, `N` 10, no age range. `--population`, `--seed` and `--age` (or `SYNTHEA_POPULATION`, `SYNTHEA_SEED`, `SYNTHEA_AGE`) change them; flags win over env. `--preset eval|training|held-out` sets all of them plus the output folder (`scripts/synthea/cohort-presets.ts`), and `--dry-run` prints the settings without running Java. Writes only to `.synthea/` (gitignored); `manifest.json` records the cohort id. Java 21+. JAR `v4.0.0` checksum is checked before run.

### Reproducible runs

The same seeds, dates, population, age range and Synthea version give the same patient files, byte for byte, in any folder and any time zone. The script does three things for that, as open-twin does since Opening-Science/open-twin#218:

- **Fixed dates.** Without them Synthea simulates up to the moment the run starts, so two runs of the same seed differ by however far apart they started. The script always passes `-r` (reference date) and `-e` (end date), both `20260101` by default and on every preset (`referenceDate` and `endDate` in `scripts/synthea/cohort-presets.ts`). `SYNTHEA_REFERENCE_DATE` and `SYNTHEA_END_DATE` (`YYYYMMDD`) change them; anything that is not a real calendar date is refused, since Synthea would quietly roll `20260230` over to 2 March. `--preset eval` refuses other dates, because the evaluation answer key is computed from that exact cohort.
- **UTC.** Synthea reads the dates in the JVM's time zone, so Java runs with `-Duser.timezone=UTC`.
- **One generator thread.** `generate.thread_pool_size = 1`: with more threads Synthea v4.0.0 has a race that changes a few fields between runs of the same seed. For large cohorts, run several cohorts in parallel instead.

`manifest.json` records `referenceDate`, `endDate`, `timezone`, `threadPoolSize`, `jarSha256`, `configSha256` (the generated `synthea.properties`), `javaVersion` and `contentSha256`, the checksum of the patient files. To compare two runs, or a run with a manifest:

```sh
cd .synthea/fhir && sha256sum *.json | LC_ALL=C sort | sha256sum
bun scripts/synthea/cohort-checksum.ts .synthea/fhir   # the same value, from TypeScript
```

`RUN_LIVE=1 bun test scripts/synthea/reproducible.live.test.ts` regenerates the evaluation cohort in a temporary folder under `TZ=America/New_York` and checks its checksum against `EVAL_CONTENT_SHA256` in `scripts/synthea/cohort-presets.ts` (Java 21+, a few minutes).

Cohorts generated before the dates were fixed cannot be regenerated byte for byte; their manifests have no dates. That covers the training and held-out cohorts, the 10,000- and 1,000,000-patient sets, any `.synthea/` made before this change, and the evaluation cohort the first answer key (2026-10-20) was built from: 33 bundles, checksum `679420920567fc854452aed9375c0fd28f4429c94156ab8df9d18d4eb8902717`.

Synthetic wearable series for the training cohorts come from `bun run wearables:generate -- --in .synthea/<cohort>/fhir` (`scripts/synthetic-wearables/`): one bundle per living subject with that subject's Synthea Patient id, ingested with `warehouse:ingest` into the same cohort. They are never added to `synthea-v4-seed42`, whose answer key they would change. Two things to know when reading them: daily heart rate (`8867-4`) and respiratory rate (`9279-1`) use the same LOINC codes as Synthea's clinic vitals, so a query on those codes returns both kinds of row; and every time is UTC (sleep, resting heart rate, HRV and respiration at 07:00, heart rate at 12:00, steps at 23:00). `wearables:generate` refuses the evaluation cohort.

### The `synthea-v4-seed42` cohort

```sh
bun run synthea:generate -- --preset eval
bun run warehouse:ingest .synthea/fhir --cohort synthea-v4-seed42
```

`bun run setup:local` runs both on an empty warehouse and refuses to ingest unless the files match `EVAL_CONTENT_SHA256` (37 files with fixed dates). `bun run setup:local -- --cohort-10k` loads the release cohort `synthea-v4-seed42-10k` instead (docs/runbook.md, "Local setup").

N=30, ages 40–75, reference and end date `20260101`. Synthea exports deceased patients as well, so there are more bundles than N: 37 bundles, 37 subjects and 35,598 numeric observations, `contentSha256` `f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb` (`EVAL_CONTENT_SHA256` in `scripts/synthea/cohort-presets.ts`; generated 2026-10-26, the same in a second run under another time zone). The evaluation answer key records the same dates and checksum (`docs/evaluation/question-set.md`). These codes are the ones B3 and C2 rely on:

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

Each machine generates and ingests its own copy; `contentSha256` in `manifest.json` shows whether two copies are the same.
