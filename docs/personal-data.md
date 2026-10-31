# Your own data: imports

Customize · Data, "Yours" (`/customize/data`), lets a person import their own records
and research files into TwinLLM on their own machine. Issues #176, #178 and #179.
Research use only; nothing here is clinical advice.

## Flow

1. **Import**, then pick a format: FHIR records, lab results (CSV), a research table, an
   Apple Health export, a wearable export (Oura, Whoop, Google), or a genome VCF.
2. Choose a file (up to 50 MB). The browser sends it to `POST /api/personal-data/review`,
   which parses it and answers with a review. Nothing is stored at this step.
3. The review shows what Save would store: counts, the date range, the codes and units
   found, the rows that will not be stored and why, and the first 20 rows as they will be
   stored. A file already imported (same SHA-256) is named and cannot be saved again.
4. **Save** sends the same file again to `POST /api/personal-data/datasets` with the
   reviewed SHA-256 and a name. The server refuses a file whose SHA-256 differs, parses it
   again and writes the dataset in one transaction. **Cancel** forgets the file; nothing
   was kept.
5. Each import is a dataset in the list below the button: rename it
   (`PATCH /api/personal-data/datasets/<id>`) or delete it
   (`DELETE /api/personal-data/datasets/<id>`). Delete removes the dataset and every row
   it holds, for good, after a five-second undo window: pressing Delete folds the row to
   "… deleted" with Undo, and the request is sent only when the window ends, so Undo
   leaves no trace and only the real delete is audited. Going to another page in the app
   inside the window sends it then. Closing or reloading the tab inside the window makes
   the browser ask first; leaving anyway sends nothing and the dataset stays.

Errors are short sentences (`features/personal-data/import-messages.ts`); the server logs
only the error name.

## Formats

### FHIR records

A FHIR R4 Bundle (any type), one resource, or NDJSON (one resource per line, as a bulk
export writes it). The file first goes through open-twin's `normaliseBundle`, the
structural gate the warehouse uses; a bundle it refuses is refused with its rule, such as
`ot-missing-required-element`. Rows are then read from the file's own resources with the
warehouse mappers (`mapObservations`, `mapConditions`, `mapMedicationRequests` in
`packages/warehouse/`), so the stored source reference is the file's own id. Nothing is
written to the warehouse.

| In the file                                               | What happens                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Observation with a number, a unit and `effectiveDateTime` | Stored; LOINC coding preferred, else the first                           |
| Blood pressure panel components                           | One row per component (`<id>#8480-6`), as in the warehouse               |
| A unit without the UCUM system                            | Stored as written, marked not UCUM unless it parses as UCUM              |
| A number without a unit or without a date                 | Reported, not stored                                                     |
| Text, coded or boolean answers                            | Reported, not stored in this version                                     |
| Condition, MedicationRequest                              | Stored as recorded: code, name, onset/abatement or authored date, status |
| Patient                                                   | Never stored: no name, identifier or birth date                          |
| Any other resource type                                   | Counted in the review, not stored                                        |

### Lab results (CSV)

A header with `date`, `test`, `value` and `unit`, and optionally `loinc` and `note`, in
any order and case; comma, semicolon or tab separated. One row is one number.

- `date`: `2024`, `2024-03`, `2024-03-01`, or a date and time with a zone
  (`2024-03-01T08:30:00Z`, `+01:00`). A time without a zone is reported: reading it in
  this machine's zone would be a guess. Partial dates keep their precision.
- `value`: a plain number. `<0.5`, `positive` or an empty cell is reported, never stored
  as zero.
- `unit`: required, stored as written and never converted.
- `loinc`: used when well formed, check digit included; a malformed code reports the row.

Without a `loinc` cell the test name is looked up in an explicit table
(`packages/personal-data/lab-test-names.ts`). Each entry names an Anchor biomarker (the
pinned open-twin catalogue, [biomarkers.md](biomarkers.md)) and the exact names that mean
it, in English and German; the code comes from Anchor, so the table invents none. There is
no fuzzy matching. Names that could mean more than one code are left out on purpose
("glucose", "CRP", "LDL"). The unit must fit the code's property: valid UCUM and either
Anchor's unit or one convertible to it, and fractions (`%`, `nmol/mmol`) must match
exactly, because HbA1c in `%` and in `mmol/mol` are different codes. A marker Anchor flags
as BLOCKING never maps. A name not in the table, or in a unit that does not fit, is stored
with its name and no code, and the review says how many.

### Research table

Any CSV or TSV with a header row of unique, non-empty names: up to 200 columns and 200,000
rows; more is refused, not cut. Each column gets one type from its non-missing cells:
`number` when every one is a plain number, `date` when every one is a calendar day
(`2024-03-01`), otherwise `text`. `""`, `NA`, `N/A`, `NaN` and `null` are missing and
stored as null. A row whose field count differs from the header is reported, not padded.

### Apple Health export

The `export.zip` the Health app writes, or the `export.xml` inside it. In a zip only
`export.xml` is read; the review says how many other files (clinical documents, routes,
ECGs) were left alone. The XML is read as a stream of `Record` tags
(`packages/personal-data/xml-elements.ts`, zip entries inflated in 1 MB steps by
`zip-entries.ts`), so it is never decoded whole.

Only these types are stored, one row per sample, in one UCUM unit each:

| Apple Health type                                                    | LOINC     | Stored in | Read from         |
| -------------------------------------------------------------------- | --------- | --------- | ----------------- |
| `HKQuantityTypeIdentifierHeartRate`                                  | `8867-4`  | `/min`    | `count/min`       |
| `HKQuantityTypeIdentifierRestingHeartRate`                           | `40443-4` | `/min`    | `count/min`       |
| `HKQuantityTypeIdentifierHeartRateVariabilitySDNN`                   | `80404-7` | `ms`      | `ms`, `s`         |
| `HKQuantityTypeIdentifierStepCount`                                  | `55423-8` | `{steps}` | `count`           |
| `HKQuantityTypeIdentifierBodyMass`                                   | `29463-7` | `kg`      | `kg`, `g`         |
| `HKQuantityTypeIdentifierBodyMassIndex`                              | `39156-5` | `kg/m2`   | `count`           |
| `HKQuantityTypeIdentifierOxygenSaturation`                           | `59408-5` | `%`       | `%` as a fraction |
| `HKQuantityTypeIdentifierRespiratoryRate`                            | `9279-1`  | `/min`    | `count/min`       |
| `HKCategoryTypeIdentifierSleepAnalysis` (asleep, core, deep and REM) | `93832-4` | `min`     | start and end     |

- A unit is converted only by a power of ten (`s` to `ms`, `g` to `kg`, Apple's `0.97`
  to `97 %`), on the digits, so the stored number is exact. Any other unit, such as `lb`,
  is reported with its name, not converted. An oxygen saturation that is not a fraction
  between 0 and 1 is reported.
- Sleep is minutes asleep per night, on the local day of waking. Overlapping samples (a
  watch and a phone) are merged first, so no minute counts twice. Time in bed and awake
  time are reported, not counted.
- The time of a sample is its `startDate` with the offset Apple wrote.
- Every other type, `Workout`, `ActivitySummary` and `Correlation` is reported by name with
  a count. Skipped records are reported as one entry per type and reason with a count,
  because an export can skip millions of them.
- The `Me` element (birth date, sex, blood type) and device and app names are never stored.
- The 200,000 cap counts the samples stored. An export with more is refused, not cut. Heart
  rate alone from a watch passes that within a year or two, so many full exports are over
  it today.

### Wearable export (Oura, Whoop, Google)

One file, or a zip of them. Each file is matched to a layout by its name and header row
(`packages/personal-data/wearable-*.ts`); a file no layout knows is listed in the review
as unsupported, never guessed at. The review names each file and the layout it was read
as.

| Source and file                                                   | Stored                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Oura JSON with `sleep`, `daily_activity`, `daily_spo2`            | Per day: main sleep minutes (`93832-4`), lowest heart rate in sleep, HRV (RMSSD), breathing rate (`9279-1`), steps (`41950-7`), SpO2 (`59408-5`) |
| Oura trends CSV (`date`, `Total Sleep Duration` in seconds, …)    | The same values from the columns it has                                                                                                          |
| Whoop `physiological_cycles.csv`                                  | Resting heart rate (`40443-4`), HRV (RMSSD), SpO2 (`59408-5`) at the cycle start                                                                 |
| Whoop `sleeps.csv`                                                | Minutes asleep on the day of waking (`93832-4`), respiratory rate (`9279-1`); naps reported                                                      |
| Whoop `workouts.csv`                                              | Duration and average heart rate, by name, with the activity as the note                                                                          |
| Fitbit in Google Takeout, `resting_heart_rate-YYYY-MM-DD.json`    | Resting heart rate per day (`40443-4`); a 0, Fitbit's day without a reading, is reported                                                         |
| Fitbit in Google Takeout, `sleep-YYYY-MM-DD.json`                 | Minutes asleep of the main sleep on `dateOfSleep` (`93832-4`); naps reported                                                                     |
| Fitbit in Google Takeout, `weight-YYYY-MM-DD.json`                | BMI (`39156-5`). The weight has no unit in the file, so it is reported, not stored                                                               |
| Fitbit in Google Takeout, per-sample `steps-…` and `heart_rate-…` | Reported: the times have no zone, so a daily total would be a guess                                                                              |

- HRV from Oura and Whoop is RMSSD; LOINC `80404-7` is SDNN, so RMSSD is stored by name
  with no code. The lowest heart rate in an Oura sleep is not a resting rate and is stored
  by name too, as are Whoop workout values.
- Daily step totals use `41950-7` (`{steps}/d`), as the synthetic wearables do; Apple's
  per-sample steps use `55423-8`.
- Whoop times are local with a `Cycle timezone` column (`UTC+02:00`); a row without it is
  reported.
- An empty cell or `null` is reported as empty, never stored as zero.
- These layouts follow the export formats as this import knows them and are tested only
  on made-up fixtures, never on a real export. When a vendor changes its file names or
  columns, the files are listed as unsupported until a layout is added.

### Genome VCF

One person's VCF 4.0 to 4.5, plain or gzip (bgzip included), on GRCh38. The file is read
as a stream (`packages/personal-data/parse-vcf.ts`): gzip is inflated in 64 kB steps and
the text decoded in 1 MB steps and split into lines, so neither is ever held whole.

- **Caps.** The upload is 50 MB like every import. The text after gzip may be up to
  500 MB and the file up to 200,000 variant records; past either the read stops and the
  file is refused, never cut. An exome or a filtered call set fits; a whole genome (4 to 5
  million records) does not yet.
- **Build.** Decided as the genome track decides it ([genome.md](genome.md), "Build
  mismatch"), from the header only (`vcf-build.ts`): a build token in `##reference=`
  (`GRCh38`, `hg38`, `GRCh38.p14`, also inside a path such as
  `file:///ref/GRCh38_full_analysis_set.fa`) and `assembly=` in `##contig` lines. GRCh37,
  hg19 or b37 is refused as `BUILD_MISMATCH`, any other named build as `BUILD_UNKNOWN`,
  even with an assumption set. A file that names no build (a `##reference` path with no
  build token names none) is refused as `BUILD_UNKNOWN` unless `GENOME_ASSUME_BUILD=GRCh38`
  is set. The build is never guessed from contig names or lengths.
- **One sample.** The `#CHROM` line must have the eight fixed columns, `FORMAT` and exactly
  one sample; none or several are refused. The sample's name is never stored.
- **Per record** the chromosome as written, the position, the ID (null for `.`), the
  reference and alternate alleles, FILTER (null for `.`) and the sample's GT as written
  (`0/1`, `1|1`, null for a no-call such as `./.`). QUAL, INFO and the other FORMAT fields
  are not stored.
- **Reported, not stored**, each reason once with its first line and a count: a record
  without ten columns, a position that is not a whole number above 0, a reference that is
  not A, C, G, T or N, a symbolic or breakend allele (`<DEL>`), a reference-only record
  (ALT `.`, or only `<NON_REF>` or `<*>` as a gVCF writes them; a trailing `<NON_REF>` after
  real alleles is dropped), no GT, or a GT that is not a genotype or names an allele the
  record does not list.
- **Review.** Counts, the build and where it came from, genotype counts (homozygous
  reference, heterozygous, homozygous alternate, no call), records per chromosome, the
  reasons and the first 20 records as they will be stored.
- **Refused files.** Not a VCF (`not-vcf`), not VCF 4.x (`vcf-version`), records before
  the `#CHROM` line, an unreadable gzip, not UTF-8, over a cap.
- **Tests** use `scripts/genome-synth` output (plain, gzip and two gzip members) and
  made-up lines, never a person's genome.

Every file must be UTF-8 (a BOM is fine).

## What is stored

Migration `20261027220000_personal_imports` adds five tables and
`20261030120000_personal_variants` a sixth, all owned by a user and
deleted with the user or the dataset (cascade). They never touch `subjects`,
`observations` or the other warehouse tables.

| Table                       | Holds                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personal_datasets`         | `user_id`, `kind` (`fhir`, `lab-csv`, `table`, `apple-health`, `wearable`, `vcf`), `name`, `source_file_name`, `sha256` of the file, `byte_size`, `status` (`ready`), `row_count`, `first_at`, `last_at`, `genome_build`; unique on `(user_id, sha256)` |
| `personal_observations`     | `code_system`, `code` (null when none), `display`, `value`, `unit` as written, `unit_ucum`, `effective_at`, `effective_precision`, `source_ref`, `note`                                                                                                 |
| `personal_clinical_records` | `resource_type` (`Condition`, `MedicationRequest`), `code_system`, `code`, `display`, `start_at`, `end_at`, `status`, `source_ref`                                                                                                                      |
| `personal_tables`           | `columns` (JSON: name, type, missing count) and `row_count`                                                                                                                                                                                             |
| `personal_table_chunks`     | Up to 1,000 rows each as a JSON array of arrays in column order, `chunk_index`                                                                                                                                                                          |
| `personal_variants`         | A VCF's records: `chrom`, `pos`, `variant_id`, `ref`, `alt`, `genotype` (GT as written, null for a no-call), `filter`                                                                                                                                   |

CHECK constraints hold `kind`, `status`, `effective_precision` and `resource_type` to
their values; migration `20261028120000_personal_import_kinds` adds `apple-health` and
`wearable` to `kind`. Migration `20261030120000_personal_variants` adds `vcf`, the
`personal_variants` table and `genome_build` on `personal_datasets`: `GRCh38` for a VCF
and null for every other kind, held by a CHECK. The file itself is not kept, only the rows above. For a zip, the
SHA-256 is the zip's.

## Privacy

- **Personal mode only.** Importing, listing, renaming and deleting need
  `DATA_MODE=personal` (`permitImportedDataStore` in `infrastructure/data-mode-policy.ts`).
  In synthetic mode the section says imports are off and every route answers 403.
- **On this machine, not encrypted yet.** The page says: "Stored on this machine in
  TwinLLM's database. Not encrypted at rest yet (#141)." How encryption at rest will work
  is decided in [privacy-design.md](privacy-design.md).
- **Locked until you unlock it (#142).** In personal mode the Data page, every import
  route and every chat tool that reads these rows sit behind a passphrase. The first visit
  asks you to set one (at least 12 characters) and shows a recovery code once. While the
  data is locked, the page shows the unlock form instead of the list and the routes answer
  423 "Your data is locked. Unlock it to continue."; that includes importing, renaming and
  deleting. It locks on the Lock button at the foot of the sidebar, after
  `VAULT_IDLE_LOCK_MINUTES` (default 15) without a personal request, and on every restart.
  The rows themselves are not encrypted yet; the data key the passphrase opens is what
  #141 will encrypt them with ([privacy-design.md](privacy-design.md#22-142-local-unlock-before-personal-data-can-be-read),
  [runbook.md](runbook.md#local-unlock)).
- **Owner-only storage (#144).** Personal mode does not start unless the database and the
  files are open to the owner's OS user only: `.env.local` 600, the state folder and the
  BodyLoop mesh folder 700 with everything in it owner-only, and Postgres reached through
  a socket in the state folder or on loopback with a password, as a role that is not a
  superuser. The server's umask is 077, so files it writes are 600. The imported file
  itself is never written to disk, only its rows. `bun run setup:local -- --owner-cluster`
  makes the recommended cluster; `bun run lab:storage` and the Lab's "Local storage" card
  repeat the checks ([runbook.md](runbook.md#owner-only-postgres)). What this does not
  stop: a program running as the same OS user can still read `.env.local` and open the
  socket, and root can read anything. Full isolation needs OS sandboxing or a trusted
  execution environment.
- **Never sent to a hosted model.** Imported data is personal like wearable context, and
  stricter: a request that carries it (`hasImportedData` on `ProviderRequest`) is allowed
  only to Ollama, never Exoscale (the consented pilot included), OpenRouter, the remote
  GPU or Infomaniak. A chat tool that reads it must also pass
  `permitImportedDataRequest`: personal mode and Ollama on loopback.
  `infrastructure/imported-data-policy.test.ts` checks every provider. The chat tools
  that read it (#181: `imported_datasets`, `imported_latest`, `imported_trend`,
  `imported_table`, `imported_conditions`; #299: `imported_medications`) are
  offered only on such a turn, ask the policy again on every call, and keep the thread
  local-only afterwards ([query-layer.md](query-layer.md), "Imported data tools").
- **Audited, without values.** Every step appends to the audit chain
  (`features/personal-data/import-audit.ts`): `personal-data.review`, `.save`, `.list`,
  `.rename` and `.delete`. Rows hold the format, byte size, the file's SHA-256, dataset
  ids, counts and refusal codes only; never a value, unit, code, test or column name,
  dataset or file name, nor a hash of any of them. A VCF's rows carry no SHA-256 at all:
  a small VCF is a known header and a few genotypes, few enough to recover from a hash of
  the file by trying them all. They hold no genotype, position or rsID either.
- **A genome VCF is genome data.** The import itself needs only personal mode, since no
  model sees anything at that step. Its rows are read only by a model on this machine,
  under `permitVcfVariantsRequest` (personal mode and Ollama on loopback, #330;
  [genome.md](genome.md#imported-vcf)), never by the
  imported-data chat tools, which do not even list a VCF dataset. Only
  `genome_variants` (#307) reads them, by rsID or `chrN:pos`, at most 50 names a call
  ([genome.md](genome.md#imported-vcf)). A save whose audit row cannot be written
  is undone.
- **Fixtures are made up.** Tests use the hand-made files in
  `tests/fixtures/personal-import/` (see its `PROVENANCE`) and an in-memory store; never a
  person's data.

## Next

- A way to import a whole genome past the 200,000 record cap.
- Apple Health exports over the 200,000 sample cap: a way to import them (a date range, or
  per-day summaries) is not decided yet.

## Code

| Part                           | Where                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| Parsers, review, save plan     | `packages/personal-data/`                                    |
| Apple Health, wearable exports | `parse-apple-health.ts`, `parse-wearable-export.ts`          |
| Genome VCF and its build       | `parse-vcf.ts`, `vcf-build.ts`                               |
| Routes and audit rows          | `features/personal-data/import-routes.ts`, `import-audit.ts` |
| Screens                        | `features/personal-data/*.tsx`                               |
| Store                          | `infrastructure/personal-data-store.ts`                      |
| Policy                         | `permitImportedDataStore`, `permitImportedDataRequest`       |
| Chat tools (#181)              | `packages/query-tools/imported-*.ts`, `importedDataReads`    |
| Variant lookup (#307)          | `imported-variants.ts`, `genomeVariantReads`                 |
| Upload size through `proxy.ts` | `proxyClientMaxBodySize` in `next.config.ts` (52 MB)         |
| Unlock gate (#142)             | `withUnlocked` in `infrastructure/vault-runtime.ts`          |
