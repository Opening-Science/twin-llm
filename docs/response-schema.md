# Response schema v1.1

Host document emitted on chat finish (`features/chat/response/`). Zod owns the
shape. Constants `intended_use` and `not_for_diagnostic_use` are copied from
`CHAT_RESPONSE_DOCUMENT`. The four-section prompt is unchanged apart from
one line asking the model to open a declined reply with `REFUSE:`.

## JSON outline

```json
{
  "schema_version": "twin-llm.response.v1.1",
  "intended_use": "research_hypothesis_generation_n_of_1",
  "not_for_diagnostic_use": true,
  "sufficient_data": true,
  "abstained": false,
  "answer_class": "analytics",
  "data_basis": {
    "evidence_keys": ["whoop.recovery.score.2026-01-02"],
    "hallucinated_keys": [],
    "tool_calls": [
      {
        "seq": 1,
        "tool": "latest_by_loinc",
        "args_sha256": "…64 hex…",
        "result_sha256": "…64 hex…",
        "row_count": 1,
        "ts": "2026-09-27T12:00:00.000Z"
      }
    ],
    "sources": { "gbd": [], "guidelines": [], "knowledge": [] },
    "gbd_rows": []
  },
  "uncertainty": {
    "model_statement": "…",
    "level": "low",
    "reasons": []
  },
  "next_step": "none",
  "interpretation": {
    "kind": "narration",
    "text": "…",
    "narration_is_unverified": true
  }
}
```

## Versions and back-compat

`schema_version` is `twin-llm.response.v1` or `twin-llm.response.v1.1`; the
builder emits v1.1 and both parse. The v1.1 fields have parse defaults, so a
document stored before them still loads and keeps `schema_version: v1`:

| Field                 | Default       |
| --------------------- | ------------- |
| `answer_class`        | `information` |
| `uncertainty.level`   | `unknown`     |
| `uncertainty.reasons` | `[]`          |

`next_step` widened from `more_data | none` to
`none | more_data | connect_wearable | consult_clinician`, so old values stay
valid. An unknown class, level, reason or next step makes the document invalid
(it is dropped, not passed through). Old documents are not re-derived: they
read as `information` / `unknown`.

`hallucinated_keys` and `narration_is_unverified` were added in
v1 without a version bump, with parse defaults `[]` and `true`.
`sources.knowledge` was added in v1.1 the same way, with default `[]`,
together with the uncertainty reason `knowledge_only`.
`sources.literature` (#236) was added the same way, with default `[]`,
together with the reason `literature_only`.
`skill` (#42) names the skill a turn ran under, such as `sleep`. It is set by
the host from the request, never from model text, and is absent on ordinary
turns and on older documents. The skill-run audit row (`skill.<name>`) stays on
the audit chain but is not listed in `tool_calls`, because it read nothing.
`ui_context` (#47) is the turn's UI context (`infrastructure/ui-context.ts`):
open panels, the organ picked on a twin, the chart drawn large with its days and
the thread's views by kind and measure, with no values. It is set by the host
from the request and is absent when the turn carried none and on older
documents. Its `ui.context` audit row is left out of `tool_calls` too.

`interpretation.kind` is `narration` | `none` | `unrenderable`. The builder
never emits `kind=contract`. `unrenderable` is the interpreter stub only
(`reason: "no_interpreter_input"`).

## Mapping (four sections → fields)

| Section                          | Field                                        |
| -------------------------------- | -------------------------------------------- |
| Evidence Used keys except `none` | `data_basis.evidence_keys`                   |
| ... that the prompt never listed | `data_basis.hallucinated_keys`               |
| Audit rows `session_id = turnId` | `data_basis.tool_calls`                      |
| GBD structured inputs            | `data_basis.sources.gbd`                     |
| GBD normalised rows              | `data_basis.gbd_rows`                        |
| Guideline catalogue citations    | `data_basis.sources.guidelines` (default []) |
| OpenTwin knowledge citations     | `data_basis.sources.knowledge` (default [])  |
| Specialty literature citations   | `data_basis.sources.literature` (default []) |
| Uncertainty                      | `uncertainty.model_statement`                |
| Answer                           | `interpretation.text` when `kind=narration`  |
| Reply opens with `REFUSE`        | `answer_class: declined_decision_support`    |
| Host rules below                 | `answer_class`, `uncertainty.level/reasons`  |
| Host rules below + `DATA_MODE`   | `next_step`                                  |

A cited key is **offered** when it matches a key the system prompt listed:
`offeredKeys()` in `infrastructure/offered-keys.ts`, the same function the
prompt builder uses (40 per source, BodyLoop through the chat filter first).
A match is exact, case-insensitive exact, or a dotted prefix on whole segments
exactly one segment apart (`a.b` ↔ `a.b.c`, a dropped date; the shorter side
at least two segments). A cited key is a `[bracketed]` token, or a bullet
whose first word is dotted and key-like; other bullet words are prose. A
label-only match gives an attribution chip but never counts toward
`sufficient_data`. Offered keys go to
`evidence_keys`; the rest go to `hallucinated_keys`. Attribution
(`resolveAttribution`) uses the same match, against offered metrics only.

`sufficient_data` is true when there is at least one offered cited key, or at least one audit row with `row_count > 0` from a
tool that reads data about a person. Reference tools never count: `guidelines.guideline_search`, `gbd.gbd_query` and
`knowledge.knowledge_search`. Hallucinated keys never flip sufficiency either. `sources.guidelines`
holds catalogue and section metadata only (no `passage`). `sources.knowledge` holds
`{ tool, id, title, file, sectionHeading, licence }` per hit (no passage); the panel lists it
under "OpenTwin knowledge" as title · section · file. `sources.literature` holds
`{ tool, id, title, journal, year, pmcid, url, doi, licence, licenceLabel, sectionHeading }`
per article passage an agent's `knowledge_search` returned (no passage); the panel lists
each article once under "Literature" as title · PMC id · licence. Literature comes
through `knowledge.knowledge_search`, a reference tool, so it never counts as
person-level evidence ([agents.md](agents.md#literature-236)).

`abstained` is true only when there is no personal evidence **and** no
reference material: no guideline citations, no OpenTwin knowledge citations, no literature citations,
no GBD rows (before B4, a population-only answer was withheld) and no
`twin.body` view among the turn's tool outputs (`twinBodyShown`). The body on
its focus is reference anatomy shown to the person, so a `twin.body` view with
no readings is "shown, no values", not "no data". Such an answer is shown,
with `answer_class: information`. The view's `twin_body` row still counts
toward `sufficient_data` only when it read rows. `interpretation` stays
`{ kind: "none" }` when `sufficient_data` is false (reference text is not
person-level narration).

| Case        | `sufficient_data` | Reference material used        | `abstained` | `answer_class`              | `next_step`                       | `interpretation`              |
| ----------- | ----------------- | ------------------------------ | ----------- | --------------------------- | --------------------------------- | ----------------------------- |
| Data answer | true              | any                            | false       | `analytics`                 | `none`                            | `{ kind: "narration", text }` |
| Withheld    | false             | none                           | true        | `information`               | `more_data` or `connect_wearable` | `{ kind: "none" }`            |
| Guideline   | false             | `sources.guidelines` non-empty | false       | `information`               | `more_data`                       | `{ kind: "none" }`            |
| Knowledge   | false             | `sources.knowledge` non-empty  | false       | `information`               | `more_data` or `connect_wearable` | `{ kind: "none" }`            |
| Population  | false             | `gbd_rows` non-empty           | false       | `information`               | `more_data` or `connect_wearable` | `{ kind: "none" }`            |
| Body twin   | false             | a `twin.body` view was shown   | false       | `information`               | `more_data` or `connect_wearable` | `{ kind: "none" }`            |
| Declined    | any               | any                            | as above    | `declined_decision_support` | `consult_clinician`               | `{ kind: "none" }`            |

## Declines

The system prompt has one line telling the model to open its reply with
`REFUSE:` and one plain sentence, instead of the four headings, when a
question asks whether a person has a condition, needs a medicine, a test or a
doctor, or is in danger, or which dose or medicine change fits them
(`DECLINE_RULE` in `features/chat/twin-system-prompt.ts`, #274). The sentence
offers to describe the recorded values instead. The rule holds even when a tool
could read the data, so "does this recording show atrial fibrillation" is
declined, while "does this recording have a window past the research
threshold" asks what the recording holds and is answered as usual. The line
also says what is answered with the tools and the headings: what a record or
recording lists, when something was recorded, or what a metric's value is.
This is wording W3, the chat default since #329. It was chosen on the held-out
S7h set over the first wording (W1, which made qwen3:8b decline some record
and guideline questions) and a narrower one (W2, which missed most declines);
see `docs/research/eval-runs-2026-10.md`, "Choosing the decline wording on
S7h". `bun run eval -- --decline-wording w1` still runs the earlier line for a
comparison.
`classifyCompletion`
(`infrastructure/classify-completion.ts`) reads a leading `REFUSE` (after
whitespace and an optional `**` or `_`, followed by `:`, whitespace, `*`, `_`
or the end; so `**REFUSE:**` and `_REFUSE_:` count, `REFUSED` and a single
`*` do not) and
`parseTwinAnswer` sets `declined`. The guardrail runner uses the same
function on its canned completions.

A declined reply gets `answer_class: declined_decision_support`,
`interpretation: none` and `next_step: consult_clinician`, even when a tool
returned rows first. Sufficiency and `abstained` are computed as usual.

## Answer class, uncertainty and next step

All three are derived by the host from the parser output, the audit rows, the
collectors and `DATA_MODE`. Nothing is read from the model's prose.

`answer_class`: declined → `declined_decision_support`; else `sufficient_data`
→ `analytics`; else `information`.

`uncertainty.reasons`, in this order. A declined reply has `["declined"]` only.

| Code                    | When                                                 |
| ----------------------- | ---------------------------------------------------- |
| `no_personal_data`      | `sufficient_data` is false                           |
| `guideline_only`        | not sufficient and `sources.guidelines` is non-empty |
| `population_only`       | not sufficient and `gbd_rows` is non-empty           |
| `knowledge_only`        | not sufficient and `sources.knowledge` is non-empty  |
| `literature_only`       | not sufficient and `sources.literature` is non-empty |
| `hallucinated_keys`     | `hallucinated_keys` is non-empty                     |
| `tool_returned_no_rows` | any `tool_calls` row has `row_count` 0               |
| `no_model_statement`    | the Uncertainty section is missing or blank          |
| `declined`              | the reply was declined                               |

`uncertainty.level`: `high` if abstained, declined or any hallucinated key;
else `moderate` if `guideline_only`, `population_only`, `knowledge_only`,
`literature_only` or `tool_returned_no_rows`; else `low`. `unknown` only appears on a stored v1
document.

`next_step`: declined → `consult_clinician`; sufficient → `none`; else, in
`DATA_MODE=personal` with no wearable key offered and no tool row with
`row_count > 0` → `connect_wearable`; else `more_data`. GBD and knowledge rows
do not count as something to read here; guideline rows still do. Synthetic mode never
reads a wearable, so it never gets `connect_wearable`.

## Narration only

`@open-twin/interpreter` is not pinned. It needs Anchor `biomarker_id` plus
caller-supplied intervals. Wearable summaries and warehouse Observations are
not that input. The host stub returns
`{ kind: "unrenderable", reason: "no_interpreter_input" }` and never invents
`BM-*` ids.

A synthetic v0.2 contract fixture (all nine SystemIds) lives at
`features/chat/response/fixtures/contract-nine-systems.json` for the renderer
and pin smoke. It is not adapter output.

## When the document is built

`features/chat/stream-model-response.ts` builds the document once, in
`onFinish`, after this turn's audit rows (`session_id = turnId`) are read
, with the server's `DATA_MODE`. The UI stream holds back its `finish`
chunk until then and sends metrics and document together in one
`message-metadata` chunk. If the audit read or build fails, the stream still
finishes, without a document, and the text is stored without one. If storing
the row fails, the row is marked `FAILED` rather than left `STREAMING`
(`features/chat/finish-model-response.ts`). A turn refused before any model
runs (data-mode policy or a skill rule) builds no document: its row is marked
`REFUSED` with TwinLLM's refusal sentence as its text
(`features/chat/start-answer.ts`), and a reload shows that sentence.

The document is stored on `model_responses."responseDocument"` (nullable
JSONB) and reloaded on `/t/[threadId]`. Both the browser stream and the
stored column pass through `toResponseDocument`
(`infrastructure/response-document/parse.ts`). Anything that is not a valid
v1 or v1.1 document is dropped, and the answer renders as plain text.
The document holds only the hashes of each tool call; the inputs and outputs
themselves are stored next to it in `model_responses."toolParts"`
(`docs/storage.md`, "Tool parts of an answer").

The schema, copy and parser live in `infrastructure/response-document/` so
the arena feature can import them. `features/chat/response/{document-v1,copy}.ts`
re-export them.

## UI copy

Strings live in `infrastructure/response-document/copy.ts` and are imported,
never repeated. Codes (`answer_class`, reasons, `next_step`) are never shown.

- Narration label (above the answer when `kind=narration`): `Unverified narration`
- Abstain banner: `Not enough data — this reply is withheld.` When
  `abstained` is true the answer text, reasoning and the model's
  uncertainty statement are not shown, only the banner and the data basis.
- Declined banner: `Declined — this research tool does not make health decisions such as doses or medicine changes.`
  Shown instead of the abstain and guideline banners. The model's reply text
  is withheld, as for an abstained answer.
- Guideline-only banner: `Answer drawn from published guidelines only; no data about you was used.`
- Guideline references: `Published guideline passage as reference material, not a statement about this person.`
- Population context: `Population estimate (IHME GBD 2021), not a statement about this person.`
  Each row is formatted by `formatGbdRow` (`infrastructure/response-document/gbd-labels.ts`):
  codes become plain labels (`deaths` → `Deaths`, `both` → `Both sexes`,
  `age_standardized` → `Age-standardised`, metric `rate` → `per 100,000`), and
  `(uncertainty interval lower–upper)` is added when both bounds are present.
- Uncertainty level: `Uncertainty: high (based on the data behind this answer).`
  (`low`, `moderate`, `high`; nothing for `unknown`)
- Uncertainty reasons, one line each:
  - `no_personal_data`: `No person-level data was used.`
  - `guideline_only`: `Only published guidelines support this answer.`
  - `population_only`: `Only population figures support this answer.`
  - `knowledge_only`: `Only OpenTwin notes about TwinLLM itself support this answer.`
  - `literature_only`: `Only published articles support this answer.`
  - `hallucinated_keys`: `Some cited keys were not in the model's context.`
  - `tool_returned_no_rows`: `A data lookup returned no rows.`
  - `no_model_statement`: `The model wrote no uncertainty statement.`
  - `declined`: `The request was declined.`
- Next step (nothing for `none`):
  - `more_data`: `A firmer answer needs more data than this one had.`
  - `connect_wearable`: `Connect and sync a wearable so answers can use your own data.`
  - `consult_clinician`: `A clinician is the right person to ask about this.`
- Unrenderable interpretation: `No structured interpretation is available for this answer.`
  (the `no_interpreter_input` code is never shown)
- Hallucinated keys: `The model cited N keys that were not in its context.`
  (`1 key` for one). A count only; the key strings are never shown.
- Tool-call count: `N data lookups recorded for this answer.` (`1 data lookup …` for one)

Panel order: reasoning, evidence used (then the hallucinated-key line), guideline references, population
context (GBD rows and attribution line), uncertainty (level, reasons, then the model's statement), next
step, tool-call count.
