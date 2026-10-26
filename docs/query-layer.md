# Query layer

Closed, parameterised reads over the Synthea warehouse. The model never writes SQL. Wearable summaries stay text in `buildTwinSystemPrompt`. The four-section prompt and the DATA_MODE provider permit are unchanged.

## Tools

| Name                       | Input                                                                    | Output                                                                                       | Max rows        |
| -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------- |
| `list_subjects`            | `cohort_id`                                                              | `{ subjects: [{ subject_ref }] }`                                                            | 200             |
| `subject_window`           | `subject_ref`                                                            | `{ start, end, n_observations }`                                                             | —               |
| `observations_for_subject` | `subject_ref`, `loinc[]`, `start`, `end`, `limit`                        | `{ rows }` with `unit_ucum`                                                                  | `limit` ≤ 500   |
| `latest_by_loinc`          | `subject_ref`, `loinc[]`                                                 | one row per code that exists                                                                 | 20 codes        |
| `summary_stats`            | `subject_ref`, `loinc`, `start`, `end`                                   | `{ n, min, max, mean, unit }`                                                                | —               |
| `trend`                    | `subject_ref`, `loinc`, `start`, `end`                                   | `{ n, first_at, last_at, slope_per_day, slope_unit, fitted_first, fitted_last, unit }`       | 5000            |
| `baseline_deviation`       | `subject_ref`, `loinc`, `baseline {start, end}`, `target {start, end}`   | `{ baseline { n, median, mad }, target { n, median }, robust_z, unit }`                      | 5000 per window |
| `coverage`                 | `subject_ref`, `loinc[]`, `start`, `end`                                 | `{ days_in_window, codes: [{ n, days_with_data, coverage_ratio, longest_gap_days, unit }] }` | 5000, 20 codes  |
| `compare_windows`          | `subject_ref`, `loinc`, `window_a {start, end}`, `window_b {start, end}` | `{ window_a, window_b }` with `n, mean, median, min, max`, `delta_b_minus_a`, `unit`         | 5000 per window |
| `guideline_search`         | `query`, `k` (default 5, max 8)                                          | catalogue + `passage` (null when `cite_only`)                                                | `k` ≤ 8         |
| `knowledge_search`         | `query`, `k` (default 5, max 8)                                          | file, title, section, `passage` (OpenTwin knowledge, `docs/knowledge.md`)                    | `k` ≤ 8         |

Inputs are Zod schemas (`packages/query-tools/schemas.ts`). LOINC is `\d{1,5}-\d+`. Window bounds are ISO-8601 UTC datetimes or plain `YYYY-MM-DD` dates; a plain date means the whole UTC day, so `start: 2026-09-01` begins at 00:00:00.000Z and `end: 2026-09-01` ends at 23:59:59.999Z. A UTC datetime may omit seconds (`2026-10-01T08:00Z` reads as 08:00:00.000Z). There are no free-text filter columns.

Warehouse tools use Prisma `findMany` / `aggregate` only. No `$queryRaw` in those bodies. `guideline_search` is the exception: cosine rank over `vector` needs `$queryRaw` (`<=>`). It is audited as `guidelines.guideline_search` with `subject_ref` null and never counts toward `sufficient_data`. `knowledge_search` uses the same SQL with `WHERE d.source = 'opentwin-knowledge'` (guideline search passes `'guideline'`), is audited as `knowledge.knowledge_search`, and never counts toward `sufficient_data` either. A failed knowledge search stores `{ "error": "knowledge-search-failed" }`, never the message. Outside the tools, the Data page's cohort summaries are the only other `$queryRaw` (fixed statements, cohort id bound; `docs/warehouse.md`, "Data page"); their audit `row_count` is the observations summarised.

## Analytics

`trend`, `baseline_deviation`, `coverage` and `compare_windows` read rows with one fixed `findMany` per window (`packages/query-tools/ports.ts`) and do the maths in `packages/query-tools/stats.ts`, so the model never computes a slope or a median itself.

- `trend`: least-squares slope per day, with fitted values at the first and last observation. `null` when n < 3 or the rows span under 2 days.
- `baseline_deviation`: robust z = (target median − baseline median) / (1.4826 · baseline MAD). `null` when the MAD is 0 or a window is empty. `mad` is unscaled.
- `coverage`: UTC calendar days from the start's day to the end's day, inclusive, so an end at midnight UTC counts that day (1 Jan 00:00 to 10 Jan 00:00 is 10 days). `longest_gap_days` is the longest run of days with no row, counting the gap before the first and after the last row. All requested codes are read together, so the 5000-row cap covers all codes at once, not each code.
- `compare_windows`: deltas are B minus A, `null` when either window is empty.

A statistic with no data is `null`, never 0. Counts stay 0. Refusals have a `code`:

- `MIXED_UNITS` (with `loinc` and `units`): the rows for one code use more than one unit. There is no unit conversion, so nothing is averaged across units. `summary_stats` follows the same rule.
- `ROW_CAP_EXCEEDED`: a window holds more than 5000 rows. The tool refuses rather than fit a truncated series. Exactly 5000 rows is accepted.

Audit `row_count` is the number of observations read (both windows for two-window tools). Any refusal records 0, so a refused call never counts toward `sufficient_data`.

A tool that throws (database down, a bad decimal) is still audited, for all nine warehouse tools: `row_count` 0 and `result` `{ "error": "query-tool-failed" }`. The error message is not stored. The error is then rethrown to the caller.

## Manifests

The same `TOOL_DEFINITIONS` emit:

- OpenAI-compatible `{ type: "function", function: { name, description, parameters } }`
- MCP `{ tools: [{ name, description, inputSchema }] }`

Snapshots: `packages/query-tools/__snapshots__/`. The MCP manifest is what `bun run mcp:serve` lists (see "MCP server").

Models get a slim form of each input schema, built in one place (`modelJsonSchema` in `packages/query-tools/model-schema.ts`) and used by chat, the eval harness, the OpenAI tool list and the training data. It is zod's draft-07 JSON Schema without `$schema`, regex `pattern`s, `format`s or the root description, so a window bound is a plain `string` with its description; every property, type, enum, bound and required list stays. zod's version spends about three quarters of its tokens on three date regexes per window bound: with the Qwen3 chat template the nine tools go from 11,947 tokens in chat (8,562 in the training data, which already dropped some patterns) to 2,157. Validation is unchanged: `modelInputSchema` parses every call with the zod schema before `execute`, so an impossible date such as `2024-02-30` is refused as before and never reaches the database or the audit chain. The MCP manifest keeps zod's full schema, patterns included, because it is the contract for external clients, which may validate arguments with it.

## MCP server

`bun run mcp:serve` (`scripts/mcp-server.ts`) serves the nine warehouse tools to an MCP client over stdio, with the env from `.env.local`. The tool list is `mcpToolManifest()`, so it equals the committed snapshot; every call is parsed with the tool's zod schema and then runs the same function chat runs (`packages/query-tools/mcp-server.ts`), so scope and audit are unchanged: a call outside the synthetic cohorts returns `SUBJECT_SCOPE_VIOLATION`, every call appends one audit event with `actor` `mcp` and one `session_id` per server process, and a call that throws is audited as `query-tool-failed` and answered with a fixed error text. Invalid arguments are refused before the tool runs and are not audited. Logs go to stderr; stdout is the protocol.

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

## Scope

- `DATA_MODE=synthetic`: subjects with `is_synthetic = true` in a cohort listed in `SYNTHETIC_COHORTS` (`packages/query-tools/scope.ts`): `open-twin-synthea-trimmed-3`, `synthea-v4-seed42`, and the training and held-out cohorts `synthea-v4-seed4242` and `synthea-v4-seed9001`. The Body twin's Demo reads only `DEMO_COHORTS` (the first two), through the separate synthetic display scope. See `docs/warehouse.md`.
- `DATA_MODE=personal`: empty warehouse scope (personal snapshots are not in these tables). The Data page and the Demo still show the synthetic cohorts through their own display scope, which the chat tools never use.

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

Outside the tools, the chat route and the onboarding starter questions write `provider.personal_data_sent` (`subject_ref` null, `row_count` 0, args `{ provider, modelId }`) for each personal request they send to Exoscale under `EXOSCALE_PERSONAL_DATA=consented-pilot`, before the model is called. Chat uses the turn id as `session_id`, the starters the actor (`docs/providers.md`).

## Chat wiring

`streamModelResponse` passes `createQueryTools(...)`, `createGbdTools(...)`,
`createGuidelineTools(...)`, `createKnowledgeTools(...)`, and `stopWhen: isStepCount(8)`. Every tool
`execute` calls `append` before the result is returned to the model.
