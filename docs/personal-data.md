# Your own data: imports

Customize · Data, "Yours" (`/customize/data`), lets a person import their own records
and research files into TwinLLM on their own machine. Issue #176. Research use only;
nothing here is clinical advice.

## Flow

1. **Import**, then pick a format: FHIR records, lab results (CSV) or a research table.
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
   it holds, for good.

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

Every file must be UTF-8 (a BOM is fine).

## What is stored

Migration `20261027220000_personal_imports` adds five tables, all owned by a user and
deleted with the user or the dataset (cascade). They never touch `subjects`,
`observations` or the other warehouse tables.

| Table                       | Holds                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personal_datasets`         | `user_id`, `kind` (`fhir`, `lab-csv`, `table`), `name`, `source_file_name`, `sha256` of the file, `byte_size`, `status` (`ready`), `row_count`, `first_at`, `last_at`; unique on `(user_id, sha256)` |
| `personal_observations`     | `code_system`, `code` (null when none), `display`, `value`, `unit` as written, `unit_ucum`, `effective_at`, `effective_precision`, `source_ref`, `note`                                              |
| `personal_clinical_records` | `resource_type` (`Condition`, `MedicationRequest`), `code_system`, `code`, `display`, `start_at`, `end_at`, `status`, `source_ref`                                                                   |
| `personal_tables`           | `columns` (JSON: name, type, missing count) and `row_count`                                                                                                                                          |
| `personal_table_chunks`     | Up to 1,000 rows each as a JSON array of arrays in column order, `chunk_index`                                                                                                                       |

CHECK constraints hold `kind`, `status`, `effective_precision` and `resource_type` to
their values. The file itself is not kept, only the rows above.

## Privacy

- **Personal mode only.** Importing, listing, renaming and deleting need
  `DATA_MODE=personal` (`permitImportedDataStore` in `infrastructure/data-mode-policy.ts`).
  In synthetic mode the section says imports are off and every route answers 403.
- **On this machine, not encrypted yet.** The page says: "Stored on this machine in
  TwinLLM's database. Not encrypted at rest yet (#141)."
- **Never sent to a hosted model.** Imported data is personal like wearable context, and
  stricter: a request that carries it (`hasImportedData` on `ProviderRequest`) is allowed
  only to Ollama, never Exoscale (the consented pilot included), OpenRouter, the remote
  GPU or Infomaniak. A chat tool that reads it must also pass
  `permitImportedDataRequest`: personal mode and Ollama on loopback.
  `infrastructure/imported-data-policy.test.ts` checks every provider. No chat tool reads
  imported data yet; that is #181.
- **Audited, without values.** Every step appends to the audit chain
  (`features/personal-data/import-audit.ts`): `personal-data.review`, `.save`, `.list`,
  `.rename` and `.delete`. Rows hold the format, byte size, the file's SHA-256, dataset
  ids, counts and refusal codes only; never a value, unit, code, test or column name,
  dataset or file name, nor a hash of any of them. A save whose audit row cannot be written
  is undone.
- **Fixtures are made up.** Tests use the hand-made files in
  `tests/fixtures/personal-import/` (see its `PROVENANCE`) and an in-memory store; never a
  person's data.

## Next

- Apple Health export (#178), wearable export files (#179) and a genome VCF, local models
  only (#180), through the same review and Save flow.
- Chat tools that read imported data, closed shapes, local models only (#181).

## Code

| Part                           | Where                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| Parsers, review, save plan     | `packages/personal-data/`                                    |
| Routes and audit rows          | `features/personal-data/import-routes.ts`, `import-audit.ts` |
| Screens                        | `features/personal-data/*.tsx`                               |
| Store                          | `infrastructure/personal-data-store.ts`                      |
| Policy                         | `permitImportedDataStore`, `permitImportedDataRequest`       |
| Upload size through `proxy.ts` | `proxyClientMaxBodySize` in `next.config.ts` (52 MB)         |
