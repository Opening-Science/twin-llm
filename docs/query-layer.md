# Query layer

Closed, parameterised reads over the Synthea warehouse, and four wearable tools over the turn's own snapshots ("Wearable tools" below). The model never writes SQL. Wearable summaries stay text in `buildTwinSystemPrompt`. The four-section prompt and the DATA_MODE provider permit are unchanged.

## Tools

| Name                       | Input                                                                                                   | Output                                                                                                                                                        | Max rows         |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `list_subjects`            | `cohort_id`                                                                                             | `{ subjects: [{ subject_ref }] }`                                                                                                                             | 200              |
| `subject_window`           | `subject_ref`                                                                                           | `{ start, end, n_observations }`                                                                                                                              | —                |
| `observations_for_subject` | `subject_ref`, `loinc[]`, `start`, `end`, `limit`                                                       | `{ rows }` with `unit_ucum`                                                                                                                                   | `limit` ≤ 500    |
| `latest_by_loinc`          | `subject_ref`, `loinc[]`                                                                                | one row per code that exists; `codes_without_rows`; `NO_ROWS` when none has one                                                                               | 20 codes         |
| `summary_stats`            | `subject_ref`, `loinc`, `start`, `end`                                                                  | `{ n, min, max, mean, unit }`                                                                                                                                 | —                |
| `trend`                    | `subject_ref`, `loinc`, `start`, `end`                                                                  | `{ n, first_at, last_at, slope_per_day, slope_unit, fitted_first, fitted_last, unit }`                                                                        | 5000             |
| `baseline_deviation`       | `subject_ref`, `loinc`, `baseline {start, end}`, `target {start, end}`                                  | `{ baseline { n, median, mad }, target { n, median }, robust_z, unit }`                                                                                       | 5000 per window  |
| `coverage`                 | `subject_ref`, `loinc[]`, `start`, `end`                                                                | `{ days_in_window, codes: [{ n, days_with_data, coverage_ratio, longest_gap_days, unit }] }`                                                                  | 5000, 20 codes   |
| `compare_windows`          | `subject_ref`, `loinc`, `window_a {start, end}`, `window_b {start, end}`                                | `{ window_a, window_b }` with `n, mean, median, min, max`, `delta_b_minus_a`, `unit`                                                                          | 5000 per window  |
| `range_position`           | `subject_ref`, `loinc`, `start`, `end`, `pick`, `at`                                                    | `{ n, effective_at, value, unit, marker_id, range, position, depends_on, facts_used }`                                                                        | 5000             |
| `convert_unit`             | `value`, `from`, `to`, `analyte` (enums)                                                                | `{ analyte, from_value, from_unit, value, unrounded, unit, formula, rounding }`                                                                               | no rows          |
| `cohort_position`          | `subject_ref`, `loinc`, `start`, `end`                                                                  | `{ value, unit, n, n_lower, n_equal, n_higher, percentile, method, rows_read }`                                                                               | 20000 (cohort)   |
| `conditions_timeline`      | `subject_ref`, `start`, `end`, `status`?, `code`?                                                       | `{ n, n_codes, by_status, n_without_abatement, conditions }`, each `code_system, code, display, onset_at, abatement_at, clinical_status, verification_status` | 1000 records     |
| `medications_timeline`     | `subject_ref`, `start`, `end`, `status`?, `code`?                                                       | `{ n, n_codes, by_status, n_with_dosage_text, medications }`, each `code_system, code, display, authored_at, status, intent, dosage_as_recorded`              | 1000 records     |
| `sleep_summary`            | `subject_ref` (synthetic only), `source` (enum), `start`, `end`                                         | `{ n, sources: [{ source, nights, score_name, mean_duration_min, mean_in_bed_min, mean_efficiency_pct, mean_score }], nights: [{ source, day, … }] }`         | 5000 (synthetic) |
| `hrv_trend`                | `subject_ref` (synthetic only), `source` (enum), `start`, `end`                                         | `{ measure, n, sources: [{ source, key, unit, n, slope_per_day, slope_per_week, fitted_*, recent, baseline, robust_z }] }`                                    | 5000 (synthetic) |
| `resting_hr_trend`         | `subject_ref` (synthetic only), `source` (enum), `start`, `end`                                         | as `hrv_trend`                                                                                                                                                | 5000 (synthetic) |
| `training_load`            | `subject_ref` (synthetic only), `source` (enum), `start`, `end`, `sport`, `aggregation` (enums)         | `{ n, periods: [{ source, period_start, sport, sessions, minutes, max_strain, calories }], sources: [{ source, sessions, minutes, recent_load }] }`           | 5000 (synthetic) |
| `cross_source_compare`     | `measure` (hrv, resting_hr, sleep_duration, sleep_efficiency), `source_a`, `source_b`, `start`, `end`   | `{ n_pairs, first_day, last_day, mean_a, mean_b, mean_difference, sd_difference, limits_of_agreement, pearson_r, unit }`                                      | snapshots only   |
| `values_around_event`      | `subject_ref`, `loinc`, `event_kind` (condition, medication), `event_code`, `days_before`, `days_after` | `{ event { kind, code_system, code, display, at, n_records }, before, after, delta_after_minus_before, unit }`                                                | 5000 per window  |
| `guideline_search`         | `query`, `k` (default 5, max 8)                                                                         | catalogue + `passage` (null when `cite_only`)                                                                                                                 | `k` ≤ 8          |
| `knowledge_search`         | `query`, `k` (default 5, max 8)                                                                         | file, title, section, `passage` (OpenTwin knowledge, `docs/knowledge.md`)                                                                                     | `k` ≤ 8          |

Inputs are Zod schemas (`packages/query-tools/schemas.ts`). LOINC is `\d{1,5}-\d+`. Window bounds are ISO-8601 UTC datetimes or plain `YYYY-MM-DD` dates; a plain date means the whole UTC day, so `start: 2026-09-01` begins at 00:00:00.000Z and `end: 2026-09-01` ends at 23:59:59.999Z. A UTC datetime may omit seconds (`2026-10-01T08:00Z` reads as 08:00:00.000Z). There are no free-text filter columns.

Warehouse tools use Prisma `findMany` / `aggregate` only. No `$queryRaw` in those bodies. `guideline_search` is the exception: cosine rank over `vector` needs `$queryRaw` (`<=>`). It is audited as `guidelines.guideline_search` with `subject_ref` null and never counts toward `sufficient_data`. `knowledge_search` uses the same SQL with `WHERE d.source = 'opentwin-knowledge'` (guideline search passes `'guideline'`), is audited as `knowledge.knowledge_search`, and never counts toward `sufficient_data` either. A failed knowledge search stores `{ "error": "knowledge-search-failed" }`, never the message. Outside the tools, the Data page's cohort summaries and its subjects table sorted by a count or a day are the only other `$queryRaw` (fixed statements, cohort id bound; `docs/warehouse.md`, "Data page"); their audit `row_count` is the observations summarised.

## Analytics

`trend`, `baseline_deviation`, `coverage` and `compare_windows` read rows with one fixed `findMany` per window (`packages/query-tools/ports.ts`) and do the maths in `packages/query-tools/stats.ts`, so the model never computes a slope or a median itself.

- `trend`: least-squares slope per day, with fitted values at the first and last observation. `null` when n < 3 or the rows span under 2 days.
- `baseline_deviation`: robust z = (target median − baseline median) / (1.4826 · baseline MAD). `null` when the MAD is 0 or a window is empty. `mad` is unscaled.
- `coverage`: UTC calendar days from the start's day to the end's day, inclusive, so an end at midnight UTC counts that day (1 Jan 00:00 to 10 Jan 00:00 is 10 days). `longest_gap_days` is the longest run of days with no row, counting the gap before the first and after the last row. All requested codes are read together, so the 5000-row cap covers all codes at once, not each code.
- `compare_windows`: deltas are B minus A, `null` when either window is empty.
- `range_position`: one reading (`pick: latest`, the newest in the window, or `pick: at`, the one at `at`; a tie at one instant goes to the lower row id) against its Anchor v3 published range (`range { low, high, unit, population, source }`), with the Biomarkers tab's own functions (`rangeChoice`, `placeValue` in `packages/biomarkers/range-choice.ts`, `docs/biomarkers.md`). `position` is `below`, `within` or `above`, bounds inclusive. A range that depends on sex or age is chosen from the subject's stored sex and birth year (#4, `docs/warehouse.md`), and `facts_used` says which (`sex`, `age_years`, `age_note`; null for a range that needs neither). Only the birth year is stored, so the age at the reading is one of two: the reading's UTC year minus the birth year, or one less; `age_years` lists both and `age_note` says it is approximate. A range is chosen only when both ages give the same one. When the age band changes between them, or a fact is not stored (no sex, a sex Anchor has no range for, and timing, which is never stored), `range` and `position` are null and `depends_on` names the facts (`sex`, `age`, `timing`); nothing is guessed. When neither age fits any range, the answer is `NO_PUBLISHED_RANGE`. Refusals: `NO_ROWS` (no reading in the window or at `at`), `MIXED_UNITS`, `NO_PUBLISHED_RANGE` (not an Anchor marker, no range published, a D11 unit flag; checked before any read) and `UNIT_MISMATCH` (with `unit` and `range_unit`; nothing is converted, and the reason points to `convert_unit`).
- `cross_source_compare`: two linked wearables on one daily measure, paired by UTC day; only days both recorded count (`sourceAgreement` in `source-agreement.ts`). `mean_difference` is b minus a, `sd_difference` the sample standard deviation of those differences, `limits_of_agreement` the mean difference plus or minus 1.96 of them (Bland–Altman), `pearson_r` the correlation, null when either side does not vary. Under 7 paired days it is refused as `WINDOW_TOO_SHORT` (counts `{ source: "both", n }`). Personal mode only; a synthetic subject has one series, so synthetic mode is `SOURCE_NOT_CONNECTED`. Each source must hold one unit (`MIXED_UNITS`), and the two the same (`UNIT_MISMATCH` with each source's unit); nothing is converted. It says how far apart the two read, never which device is right.
- `values_around_event`: the first dated record of one condition (onset) or medication request (authored) by its code, then the LOINC's readings in the `days_before` days before it and the `days_after` days from it (a reading at the event's instant counts as after), each summarised as `compare_windows` does, with after minus before. A tie between two records at one instant goes to the lower id; `n_records` counts every dated record of the code. Refusals: `SUBJECT_SCOPE_VIOLATION`, `NO_ROWS` (no dated record of the code, said in its own sentence, or no reading on either side), `MIXED_UNITS`, `ROW_CAP_EXCEEDED`. It says what was recorded before and after a date, never that the event changed anything.
- `cohort_position`: the subject's latest reading of one code in the window (a tie at one instant goes to the lower row id) among the latest reading in the same window of every `is_synthetic` subject in the subject's own cohort: one value per person, the subject included. The result also has `cohort_id` and `effective_at`. One fixed `findMany` over the cohort (`findCohortObservations` in `ports.ts`) reads `COHORT_ROW_CAP` (20,000) + 1 rows; over the cap is refused with `COHORT_ROW_CAP_EXCEEDED` (the per-subject 5000 does not fit a cohort-wide read). `percentile` is the mid-rank percentile, 100 × (`n_lower` + `n_equal` / 2) / `n`, where `n` is the people with a value and `n_equal` counts the subject, so ties count half and the result lies strictly between 0 and 100 (`latestPerSubject`, `midRankPercentile` in `stats.ts`). Read it as "higher than about X % of the N synthetic people with a value", never better, worse or normal. Audit `row_count` is `rows_read`, not `n`. Refusals: `SUBJECT_SCOPE_VIOLATION` (personal mode, or a subject that is not synthetic or not in an allowlisted cohort; before any read), `COHORT_ROW_CAP_EXCEEDED`, `MIXED_UNITS` (two units anywhere in the cohort's rows), `NO_ROWS` (no reading for the subject in the window) and `COHORT_TOO_SMALL` (fewer than 10 people with a value; with `n` and `minimum`). No sex or age strata (#4); nothing is converted.

- `hrv_trend`, `resting_hr_trend`: per source, `olsSlopePerDay` over the window's daily readings (and × 7 per week, `slope_per_week_unit` `…/wk`), and the 7 UTC days ending on the end's day (`recent`) against the 28 days before them (`baseline`) with the `baseline_deviation` maths (`median`, `mad`, `robustZ`), whatever the window's start. A source with under 7 readings in the window has its counts and medians but no slope; no source with 7 is `WINDOW_TOO_SHORT`.
- `sleep_summary`: per source and night the main sleep's fields (`duration_min`, `in_bed_min`, `efficiency_pct`, `score`), and per source the mean of each over the nights that have it.
- `training_load`: per source, period (day, or the Monday-started UTC week) and sport: sessions, summed minutes and calories, and the highest workout strain (Whoop strain does not add up). `recent_load` sums minutes in the 7 days ending on the end's day and in the 28 days before them; `ratio` is recent ÷ (previous ÷ 4), `null` when the previous four weeks have none, and its only label is "recent load compared with the previous four weeks".

A statistic with no data is `null`, never 0. Counts stay 0. Refusals have a `code`:

- `MIXED_UNITS` (with `loinc` and `units`): the rows for one code use more than one unit. No tool converts rows, so nothing is averaged across units. `summary_stats` follows the same rule.
- `ROW_CAP_EXCEEDED`: a window holds more than 5000 rows. The tool refuses rather than fit a truncated series. Exactly 5000 rows is accepted.
- `UNSUPPORTED_CONVERSION` (with `analyte`, `from`, `to` and the `supported` pairs): `convert_unit` has no rule for that pair, or `from` equals `to`.
- `SOURCE_NOT_CONNECTED` (with `source` and the `available` ones): a wearable tool asked for a source this turn does not have: a vendor not linked in personal mode (or none at all for `all`), or any vendor for a synthetic subject.
- `WINDOW_TOO_SHORT` (with `minimum` 7 and the `counts` per source): a wearable trend with readings but fewer than 7 from every source.
- The wearable tools' `NO_ROWS` names the `measure` and `source`, and their `MIXED_UNITS` the `measure` and `source`: one source's field in two units, or in a unit other than the one the field is named for (`duration_min` in hours).

Audit `row_count` is the number of observations read (both windows for two-window tools). Any refusal records 0, so a refused call never counts toward `sufficient_data`.

A tool that throws (database down, a bad decimal) is still audited, for every warehouse tool: `row_count` 0 and `result` `{ "error": "query-tool-failed" }`. The error message is not stored. The error is then rethrown to the caller.

## Unit conversion

`convert_unit` converts one value with the exact table in `packages/query-tools/unit-conversions.ts`; the factors and their sources are in that file. Each pair is written in both directions with its own formula, so an inverse multiplies by the factor rather than dividing by a rounded reciprocal.

| Analyte                        | Pair           | Formula                        | Decimals (to) |
| ------------------------------ | -------------- | ------------------------------ | ------------- |
| glucose                        | mg/dL ↔ mmol/L | mmol/L = mg/dL ÷ 18.016        | 1 / 0         |
| creatinine                     | mg/dL ↔ umol/L | umol/L = mg/dL × 88.42         | 0 / 2         |
| hba1c                          | % ↔ mmol/mol   | mmol/mol = (% − 2.15) × 10.929 | 0 / 1         |
| total, LDL and HDL cholesterol | mg/dL ↔ mmol/L | mmol/L = mg/dL ÷ 38.67         | 2 / 0         |
| triglycerides                  | mg/dL ↔ mmol/L | mmol/L = mg/dL ÷ 88.57         | 2 / 0         |
| body_temperature               | Cel ↔ [degF]   | [degF] = Cel × 9/5 + 32        | 1 / 1         |

- Input is closed: `value` (−1000 to 100000), `from` and `to` from one UCUM enum, `analyte` from one enum. Any other pair is `UNSUPPORTED_CONVERSION`, with the pairs the table holds for that analyte.
- Output: `value` rounded half away from zero (`roundTo`, the display rule) to the decimals the target unit is usually reported in, `unrounded`, `unit`, `formula` and `rounding` (the rule in words).
- It reads no rows. There is no `subject_ref`, so no scope check, no row cap and no no-rows case; it works in both data modes. Every call is still audited (`subject_ref` null, `row_count` 0), so a conversion never counts toward `sufficient_data`.
- The same table feeds the number matcher (`CONVERSIONS` in `infrastructure/number-sources.ts`, which adds kg and mmHg) and through it the hallucination scorer, so "7.0 mmol/L" is sourced by a 126 mg/dL glucose row.
- The system prompt says to use `convert_unit` for any conversion and never to convert in the answer text.

## Clinical records

`conditions_timeline` and `medications_timeline` read the warehouse's `conditions` and `medication_requests` (`docs/warehouse.md`) with one fixed `findMany` each (`findConditions`, `findMedicationRequests` in `ports.ts`), `CLINICAL_ROW_CAP` + 1 records, and order and count them in `packages/query-tools/clinical-timeline.ts`. They list; they compute nothing about health.

- `conditions_timeline`: a condition is listed when its span overlaps the window: onset at or before the window's end, and no abatement or abatement at or after its start. A condition without an onset is never listed. Order: onset, then code, then row id.
- `medications_timeline`: a request is listed when it was authored in the window. Order: authored date, then code, then row id.
- `status` filters on the recorded clinical status (FHIR `active`, `recurrence`, `relapse`, `inactive`, `remission`, `resolved`) or the request status (`active`, `on-hold`, `cancelled`, `completed`, `entered-in-error`, `stopped`, `draft`, `unknown`); `code` on one code as stored (letters, digits, dots and hyphens). Both are echoed, null when not given.
- Statuses are the record's as exported at the end of the simulation, not the status during the window. `by_status` counts them, `unrecorded` for none.
- `dosage_as_recorded` is the record's `dosageInstruction[].text`, verbatim, or null when the record has none (2,799 of the pinned cohort's 3,615 requests). Nothing else about dosing is stored or returned.
- Refusals: `NO_ROWS` (with `record` and an `error` naming the window rule and the filters) when nothing matches, and `ROW_CAP_EXCEEDED` above 1000 records. Audit `row_count` is `n`.
- Wording: the system prompt and the tool descriptions say to list what is recorded, relate dates as before or after, never as a cause, quote dosage text as recorded and add no dose, change or advice.

## Manifests

The same `TOOL_DEFINITIONS` emit:

- OpenAI-compatible `{ type: "function", function: { name, description, parameters } }`
- MCP `{ tools: [{ name, description, inputSchema }] }`

Snapshots: `packages/query-tools/__snapshots__/`. The MCP manifest is what `bun run mcp:serve` lists (see "MCP server").

Models get a slim form of each input schema, built in one place (`modelJsonSchema` in `packages/query-tools/model-schema.ts`) and used by chat, the eval harness, the OpenAI tool list and the training data. It is zod's draft-07 JSON Schema without `$schema`, regex `pattern`s, `format`s or the root description, so a window bound is a plain `string` with its description; every property, type, enum, bound and required list stays. zod's version spends about three quarters of its tokens on three date regexes per window bound: with the Qwen3 chat template the nine tools go from 11,947 tokens in chat (8,562 in the training data, which already dropped some patterns) to 2,157. Validation is unchanged: `modelInputSchema` parses every call with the zod schema before `execute`, so an impossible date such as `2024-02-30` is refused as before and never reaches the database or the audit chain. The MCP manifest keeps zod's full schema, patterns included, because it is the contract for external clients, which may validate arguments with it.

## MCP server

`bun run mcp:serve` (`scripts/mcp-server.ts`) serves the warehouse tools and `convert_unit` to an MCP client over stdio, with the env from `.env.local`. The tool list is `mcpToolManifest()`, so it equals the committed snapshot; every call is parsed with the tool's zod schema and then runs the same function chat runs (`packages/query-tools/mcp-server.ts`), so scope and audit are unchanged: a call outside the synthetic cohorts returns `SUBJECT_SCOPE_VIOLATION`, every call appends one audit event with `actor` `mcp` and one `session_id` per server process, and a call that throws is audited as `query-tool-failed` and answered with a fixed error text. Invalid arguments are refused before the tool runs and are not audited. Logs go to stderr; stdout is the protocol.

Transport is stdio only. `DATA_MODE=personal` must stay that way: `assertTransportAllowedForDataMode` refuses a network transport (streamable HTTP, SSE) in personal mode, so anyone adding one has to go through that guard. In personal mode the warehouse scope is empty anyway (see "Scope").

Claude Desktop (`claude_desktop_config.json`) and Claude Code (`.mcp.json`) use the same entry; replace the path:

```json
{
  "mcpServers": {
    "twinllm-query-tools": {
      "command": "bun",
      "args": ["--cwd", "/path/to/twin-llm", "run", "mcp:serve"]
    }
  }
}
```

## Wearable tools

`sleep_summary`, `hrv_trend`, `resting_hr_trend` and `training_load` (#133) read wearable data and never pool sources: every row names its `source`, because two devices measure sleep, HRV and workouts differently and the same run can be recorded by both. Inputs are closed: `source` is `oura`, `whoop`, `google` or `all`; `training_load` adds `aggregation` (`day`, `week`) and an optional `sport` group (`running`, `cycling`, `walking`, `swimming`, `strength`, `other`; a vendor's sport name is matched to one in `sportGroup`). The readings come from one of two places, in `planWearableRead` (`wearable-tools.ts`), scope first:

- **Personal mode** reads the snapshots the turn already loaded, the same metrics `show_view`'s wearable path draws, one reading per key family and day (`wearable-readings.ts`). A `subject_ref` is refused with `SUBJECT_SCOPE_VIOLATION`; a source not linked is `SOURCE_NOT_CONNECTED`. The audit row has `subject_ref` null and counts the readings in the window.
- **Synthetic mode** reads the named subject's synthetic series (`scripts/synthetic-wearables`) from the warehouse with one capped `findMany` (the window and, for the trends and the load, the 35 days they compare), scoped like any cohort read. Its rows are source `synthetic`; a vendor source is `SOURCE_NOT_CONNECTED`. Synthetic mode never loads a snapshot.

| Tool               | Oura                                           | Whoop                                                       | Google Health                     | Synthetic series         |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------------- | --------------------------------- | ------------------------ |
| `sleep_summary`    | `sleep.{duration,efficiency,score}.long_sleep` | `whoop.sleep.{in_bed_min,efficiency,performance}` (no naps) | none in its summary               | `93832-4`, `sleep-score` |
| `hrv_trend`        | `sleep.hrv.long_sleep`                         | `whoop.recovery.hrv`                                        | none in its summary               | `hrv-rmssd`              |
| `resting_hr_trend` | none in its summary                            | `whoop.recovery.rhr`                                        | `google.daily-resting-heart-rate` | `40443-4`                |
| `training_load`    | `workout.{duration,calories}.<activity>`       | `workout.{duration,strain}.<sport>` (`whoop.`)              | none in its summary               | `workout-<sport>` (min)  |

Oura's main sleep is its `long_sleep` segment (#85), so a nap or a short rest is never a night. The Google Health summary keeps only top-level quantities, so its sleep sessions and HRV (FHIR components) are not in it; a Google-only question gets `NO_ROWS` for them. The MCP server passes no snapshots, so in personal mode the wearable tools there answer `SOURCE_NOT_CONNECTED`. The four tools belong to their own knowledge source, `wearable-analytics` ("Sleep, HRV, resting heart rate and workouts"), usable in both data modes.

## Imported data tools

`imported_datasets`, `imported_latest` and `imported_trend` (#181) read the person's own imported observations (`personal_observations`, `docs/personal-data.md`). They are not in `TOOL_DEFINITIONS`: their definitions are `IMPORTED_TOOL_DEFINITIONS` (`packages/query-tools/imported-schemas.ts`), the run functions are in `imported-tools.ts`, and the reads are `importedDataReads` in `infrastructure/personal-data-store.ts`, bound to the turn's own user. They never read the synthetic warehouse, and no warehouse tool reads imported rows.

| Name                | Input                                           | Output                                                                                                                                                                     | Max rows     |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `imported_datasets` | none                                            | `{ datasets: [{ dataset_id, kind, name, row_count, first_at, last_at, series: [{ loinc, name, unit, n, first_at, last_at }], other_coded_rows }], n_series, more_series }` | 300 series   |
| `imported_latest`   | `loinc[]` (1 to 20), `dataset_id`?              | `{ rows: [{ loinc, name, value, unit, effective_at, effective_precision, dataset_id }], codes_without_rows }`                                                              | one per code |
| `imported_trend`    | `dataset_id`, `loinc` or `name`, `start`, `end` | `{ dataset_id, loinc, name, unit, n, first_at, last_at, slope_per_day, slope_unit, fitted_first, fitted_last }`                                                            | 5000         |

- **Local models only.** The chat route offers them only when `permitImportedDataRequest` holds (`DATA_MODE=personal` and `LLM_PROVIDER=ollama` on loopback; `importedDataChatPermit` in `infrastructure/imported-data-gate.ts`), and every call asks again before any read. A refusal is `IMPORTED_DATA_NOT_PERMITTED` with `reason` `data-mode-not-personal` or `chat-model-not-local`. The MCP server lists them, and they always refuse there: an MCP client's model is not known to run on this machine.
- **One series at a time.** A series is one dataset's LOINC code (code system `http://loinc.org`) or one dataset's name stored with no code. Oura and Whoop HRV is RMSSD, stored by name, while `80404-7` is SDNN; asking for the code never returns the name and the reverse. Giving both is refused with `SERIES_NOT_COMBINED`. A trend reads one dataset; `imported_latest` may read all of them and says which dataset each row came from. Rows coded in another system are counted per dataset (`other_coded_rows`) and not read yet.
- **Units and dates as stored.** Units are compared as written (`mg/dL` and `mg/dl` are two) and never converted: two in one window is `MIXED_UNITS`. A row dated only to a month or a year is stored at its first instant, so a trend over one is refused with `PARTIAL_DATES`; `imported_latest` returns it with its `effective_precision`.
- **Capped.** A listing reads at most 300 series groups (`more_series` says there are more). A trend reads `ANALYTICS_ROW_CAP` + 1 rows and refuses over the cap (`ROW_CAP_EXCEEDED`). `imported_latest` reads one row per code. The trend maths is `olsSlopePerDay` in `stats.ts`, the same as `trend`; the listing and newest-row helpers are pure functions in `imported-series.ts`.
- **Other refusals.** `DATASET_NOT_FOUND` (an id that is not one of the person's datasets), `NO_ROWS` (none of the codes has a reading). A trend with no rows is `n: 0` with null statistics.
- **Audited with counts only.** Every call, refusal and throw writes one row under the tool's name, `subject_ref` null. Arguments are the dataset id, the number of codes and the window; results are counts or the refusal code; a throw is `{ "error": "imported-tool-failed" }`. Never a value, unit, code or name, nor a hash of one, which is why these tools do not use `audited()`.
- **Threads stay local.** A thread where one of them ran is held to the genome rule (`infrastructure/genome-thread-policy.ts`): every later turn runs only on Ollama on loopback, and the refusal reads "This thread used your genome report or imported data, so it only runs on local models."
- **Owned by a source.** `imported-data` ("Imported records and wearable exports"), usable only when the policy allows chat. A skill that calls them may list only `ollama`.
- Not yet: research tables (`personal_tables`), conditions and medication requests from FHIR imports, and comparisons across datasets.

## Scope

- `DATA_MODE=synthetic`: subjects with `is_synthetic = true` in a cohort listed in `SYNTHETIC_COHORTS` (`packages/query-tools/scope.ts`): `open-twin-synthea-trimmed-3`, `synthea-v4-seed42`, and the training and held-out cohorts `synthea-v4-seed4242` and `synthea-v4-seed9001`. The Body twin's Demo reads only `DEMO_COHORTS` (the first two), through the separate synthetic display scope. See `docs/warehouse.md`.
- `DATA_MODE=personal`: empty warehouse scope (personal snapshots are not in these tables). The Data page and the Demo still show the synthetic cohorts through their own display scope, which the chat tools never use.

The suggested questions on an empty chat read through the same tools: `coverage` for a synthetic subject, and `wearable_coverage` (the coverage maths over a user's own wearable snapshot, `subject_ref` null, not model-facing and not in the manifests) in personal mode. See `docs/twin-llm.md`, "Suggested questions".

A violation returns `{ code: "SUBJECT_SCOPE_VIOLATION", error: "subject_ref is not in this session scope" }` and is written to the audit chain first (`row_count` 0, `result_sha256` of that JSON).

`session_id` is the chat `turnId`. `actor` is the Clerk id or `LOCAL_USER_ID`.

## Audit

`packages/audit`: `AuditEvent` rows form a hash chain.

- Genesis `prev_hash` = 64 ASCII zeros.
- Canonical JSON = sorted keys of the event **without** `hash`. `ts` is UTC ISO with millis.
- `hash = sha256(prev_hash + canonical JSON)`.
- `append(client, …)` takes a transaction advisory lock (`pg_advisory_xact_lock(hashtext('audit_events'))`), then writes the next `seq`. The CLI builds its own Prisma client from `DATABASE_URL` and never imports `server-only`.
- `verifyChain()` → `{ ok, brokenAtSeq }`.

The audit row stores actor, session, subject_ref, tool name, and sha256 of args/result — not observation payloads.

Reads of personal data outside the tools write a row too (#143), with what the read was for and how many rows it returned, never a value. `infrastructure/personal-read-audit.ts` builds the `personal.read.<purpose>` row; when it cannot be written, the data is not sent. What is audited now:

- Wearables summary: `personal.read.wearables-summary` for Oura, Whoop and Google Health, and `vitronic.wearables.summary` from the BodyLoop reader.
- Genome report: `personal.read.genome-report` with the report's row count.
- Customize · Connectors page: in personal mode each view writes `personal.read.connectors-page` (how many of the Oura, Whoop and Google Health summaries it found), through `readConnectorSummaries` (`features/connectors/connector-summaries.ts`). When the row cannot be written the page shows its error state instead of the summaries.
- Oura, Whoop and Google Health syncs: `personal.read.sync-oura`, `personal.read.sync-whoop` or `personal.read.sync-google-health` (the provider is in the tool name because args are stored only as a hash) with the number of metrics stored, from `POST /api/<provider>/sync` and from the first sync after an OAuth callback, through `auditThenSave` (`features/wearables/audited-sync.ts`). The sync fetches first, the row is written next, and only then are the snapshot and `lastSyncAt` saved (#235), so no snapshot is stored without its row. When the row cannot be written nothing is saved, the sync route answers with its failed-sync error and the callback logs a failed initial sync. When the save fails after the row, the row stays for a sync that stored nothing. Refreshed tokens are stored during the fetch either way.
- BodyLoop status, subjects, scans, snapshots and avatar: one `vitronic.*` row each, written in the reader.
- Imports and the Data page's dataset list: `personal-data.*` (`docs/personal-data.md`).
- Thread search and export: `search.threads`, `thread.export`.
- Ark status: one `ark.*` row per Ark call, from the adapter.

Not audited, and why: the Oura, Whoop and Google Health status routes read the connection row only (linked at, last sync); Ark audit lists audit rows, not health data; BodyLoop sync, connect and upload writes, and imports, are audited where they write; OAuth authorize and disconnect read no health data. Not audited yet: the Oura, Whoop and Google Health summaries a personal-mode chat puts in the prompt. `tests/personal-reads/personal-reads.test.ts` holds this list for every `app/api` route and fails on a route it does not name, so a new route is added there by hand. It keeps a second list for pages, which are not API routes: every `page.tsx` or `layout.tsx` under `app` that reads a wearable summary must be named there and must read it through its audited reader.

Outside the tools, the chat route and the onboarding starter questions write `provider.personal_data_sent` (`subject_ref` null, `row_count` 0, args `{ provider, modelId }`) for each personal request they send to Exoscale under `EXOSCALE_PERSONAL_DATA=consented-pilot`, before the model is called. Chat uses the turn id as `session_id`, the starters the actor (`docs/providers.md`).

## Chat wiring

`streamModelResponse` passes `createQueryTools(...)`, `createGbdTools(...)`,
`createGuidelineTools(...)`, `createKnowledgeTools(...)`, and `stopWhen: isStepCount(8)`. Every tool
`execute` calls `append` before the result is returned to the model.

## How to add a tool

`bun run new:tool <snake_name>` writes one tool into every place below. Each piece carries `todo("…")` calls (`packages/query-tools/todo.ts`) that fail `bun run typecheck` with their note in the message, and throw in a test, so the typecheck lists what is left. It refuses a name that is not snake_case, that an existing tool, view tool or genome tool already uses, or whose identifiers already exist, and writes nothing when it refuses. The template is a one-LOINC, one-window tool shaped like `trend`.

The contract:

- **Closed input.** A zod object with `.strict()`, window bounds from `schemas.ts`, `z.enum` for every fixed choice, no free text. It goes into `TOOL_DEFINITIONS`, which feeds chat (`ai-tools.ts`, where the scaffold adds the entry at the end of `createQueryTools`, found by name, never in `createImportedTools`), the MCP server and both manifests.
- **Scope first.** `subjectInScope` before any read; out of scope returns `SUBJECT_SCOPE_VIOLATION`.
- **Audited.** The body runs inside `audited(...)`, so every call, refusal and throw writes one audit row; a refusal counts 0 rows.
- **Capped reads.** One fixed `findMany` per window through `readWindow` (`ports.ts`), `ANALYTICS_ROW_CAP` + 1 rows, over the cap refused. No `$queryRaw`.
- **Pure maths.** The arithmetic lives in `stats.ts`, free of I/O, tested with hand-computed numbers. Nothing to compute from is `null`, never 0.
- **Refusals with a reason.** Mixed units return `MIXED_UNITS`; any new refusal is a named code in `refusals.ts` with an `error` that says why. No rows is `n: 0` with null statistics.
- **Neutral wording.** Descriptions and answers say "within / above / below the published range", "before / after", never "because"; no advice, no warning colours, no causes.
- **Owned by a source.** The name joins a source in `infrastructure/knowledge-sources.ts` (the scaffold uses `cohort-analytics`), so `forSources` drops it when that source is off.

Done means:

- the exact-output tests in `packages/query-tools/<name>.test.ts` pass, every expected value written out;
- `bun run tools:snapshots` regenerated `__snapshots__/mcp-tools.json` and `openai-tools.json`, and the diff was read;
- the row in the table above is filled in (and an Analytics bullet, if there is maths);
- the training tool list (`scripts/training-data/chat-tool-list.test.ts`) and the skills tool list name the tool;
- at least three eval questions, one of them a refusal, each with `expect.values`, moved from `evaluation/drafts/` into `evaluation/questions.v1.json`, and the answer key rebuilt offline with `bun run eval:answer-key`;
- no `todo(` left; `bun run typecheck`, `lint`, `build` and `test` pass.

`bun run new:tool:prove` scaffolds a throwaway tool into a temporary copy of the checkout and runs the full typecheck there: it passes when tsc fails on the todo markers and on nothing else. It takes a few minutes, so CI runs the faster checks in `scripts/new-tool/new-tool.test.ts`.
