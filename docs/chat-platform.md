# Chat as a working surface

Plan for taking the chat from text answers to a surface that shows views, runs skills and drives the twin. Milestone [v0.3.0](https://github.com/Opening-Science/twin-llm/milestone/2); tracking issue #34. Research use only, as in the README.

## Where we are

The chat is a narrow pipe. Twelve closed tools (nine query tools, GBD, guidelines, knowledge) are built in `features/chat/chat-tools.ts`; every call lands on the hash-linked audit chain (`packages/audit`), and `infrastructure/data-mode-policy.ts` keeps personal data local. Answers are text in four sections plus an explainability panel.

What is missing: no charts or cards in answers, tool calls show as one status line, and tool outputs are not stored (`ModelResponse` keeps hashes only). The `/` menu only connects wearables. There is no MCP server, no in-app docs page, and the 3D twin, the genome helix and the wearable charts are not reachable from chat. A generic, computed walk and idle clip play on the scans' 31-joint skeleton and the rigged demo body (#51); `live-motion.ts` scales the heart and lungs.

## Principles

1. Numbers in views come from tool results, never from the model. The model asks for a view; the server builds it from audited rows.
2. Everything the twin shows or does is audited like a query.
3. Skills are data plus tests. Each ships with its own evaluation cases.
4. The app stays TypeScript. Python lives at the edges (training, sidecars, analysis) behind HTTP or MCP.
5. Local-first holds for every new part: views, skills, MCP servers and specialist models all go through the data-mode policy.

## 1. Views

A `data-view` stream part `{id, kind, title, spec, sourceAuditIds}`, rendered inline and listed in an Outputs panel per thread. A `show_view` tool takes `{kind, measure, window, subject}`, runs the matching query tool and returns the spec. Kinds: `chart.timeseries`, `chart.compare`, `biomarker.card`, `twin.body`, `table`, `map.choropleth` (#388). `list_views` and `open_view` reopen a stored view instead of recomputing. Tool parts are stored per response so a reloaded thread renders the same.

Since #36: `show_view` with `chart.timeseries` reads a LOINC code for a synthetic subject (audit tool `timeseries`) or a wearable key from the turn's loaded snapshot (audit tool `wearable_series`); `sourceAuditIds` are those rows' `seq`. The model reads back only what was drawn, not the points. A window with no readings gives a view that says so and draws nothing. `show_view` is in the model-facing tool list but not the MCP manifest.

Since #39: each tool call is a folded card above the answer (`features/arena/tool-cards.ts`): the call in plain words, its named arguments (measure, window, subject, search), running, done, refused or failed, and the rows it read. Outputs never reach a card; a refusal shows a fixed sentence by its code. A reload builds the same cards from the stored tool parts, with the audit row's count, and a step's parallel calls are stored in call order so they do not reorder.

Since #37: an Outputs panel beside the thread (above it on narrow screens) lists every view its answers show, newest first, with title, kind, model and time; a row scrolls to the chart, Enlarge draws it large in the panel. It collapses or closes, and the choice is kept in the browser's local storage. `list_views` lists the thread's views (id, title, kind, model, time; no points) and `open_view(id)` returns a stored view unchanged, streamed as a `data-view` part with no new query. Both read the thread's stored tool parts, are audited (`open_view` with the view's subject and point count), a synthetic request is not offered wearable views, and a skill turn gets them only when its skill allows a kind `show_view` draws. The views come from the stored tool parts, so no table or migration was added. Views with no readings are listed dimmed. View titles use plain dates (`Heart rate, 1 Jan 2016 – 31 Oct 2026`), and `show_view` refuses a measure that is neither a LOINC code nor a wearable key the app labels or the turn loaded (`UNKNOWN_MEASURE`) rather than drawing an empty chart.

Since #38: `show_view` also draws `chart.compare`, `biomarker.card` and `table` (`infrastructure/view-specs.ts` holds each spec's zod schema; `features/chat/view-builders.ts` builds them). `chart.compare` sets `window` against an earlier `compare_with`: for a LOINC the n and mean of each window are `compare_windows`' own and the points one `timeseries` read per window; a wearable key gets the same summary of its readings. Side by side or overlaid by day, the earlier window grey and dashed, each with its n and mean in words. `biomarker.card` runs `range_position` (latest reading, the Anchor v3 range and position from `packages/biomarkers`, or what the range depends on) and `trend` over the window; the arrow is the fitted change rounded as the value is shown, with n. A code with no published range is refused as `range_position` refuses it, and a wearable key with `LOINC_REQUIRED`. `table` lists the readings under columns the server picks from the row fields (a fixed list; text the same in every row is left to the caption), the first 50 with "Showing first 50 of N". The visuals are neutral: above and below are words, never a warning colour. All three reload from the stored tool parts and appear in the Outputs panel.

Since #111: a number in a finished answer that a tool call returned is a quiet dotted link. Pressing it (click or Enter) opens the card of every call that holds it, moves focus to the first, and the card lists the answer's numbers from that call with their rows and fields (`rows 1, 4 · value`). A number with no source stays plain. The matcher is `infrastructure/number-sources.ts`, shared with the hallucination scorer: dates and 0 to 10 are left out, a value matches by rounding or within 1 %, and a reading in another common unit (lb for kg) counts. A saved answer is matched on the server from its stored tool parts and a live one in the browser from the parts it streamed; only the number's text, the call id, the row position and the field name reach the page, never a row's values.

Since #48: `show_view` with kind `twin.body` and a `focus` shows the body twin on an organ or system. The focus is a closed list (`packages/anatomy/twin-focus.ts`): the nine body systems, and heart, lung, brain, liver, kidney, pancreas and blood vessels, HRA organ groups a biomarker or vital maps to. With `subject` (a synthetic subject_ref) it reads the newest reading of each mapped lab marker in the window, one capped read; `window` is optional for this kind only, and without it the read covers the subject's whole record (still one capped read, refused with `ROW_CAP_EXCEEDED` past the cap), so each marker's latest reading places its organ and the title says "latest readings"; and places each mapped organ under the focus with `focusOrganStatus` (`packages/biomarkers/focus-state.ts`, the reviewed organ map in `docs/biomarkers.md`); only the subject's stored sex is used, so a range that needs an age places nothing. Without `subject` nothing is read. Either way the call is one audit row, `twin_body`, and that row is the view's source. The view stores positions and marker names, never values, and the model reads back the same in words. The answer lists the positions and has "Show on the twin", which opens the `/twin` card's viewer started on the focus: the Demo body (with the subject's labs) in synthetic mode, Self with its BodyLoop scan where there is one in personal mode, at the organ layer (muscle for the musculoskeletal system, the scan for the skin), lit as a Biomarkers-tab row lights. It is a reference body with donor anatomy, and it says so. `measure` and `window` are optional in the schema for this kind and refused as `MEASURE_REQUIRED` and `WINDOW_REQUIRED` for the others; a missing focus is `FOCUS_REQUIRED`. Under a skill that does not list `cohort-records`, `show_view` reads no subject for any kind (`RECORDS_NOT_IN_SKILL`). A `twin.body` view keeps the answer from being withheld even with no readings ([response-schema.md](response-schema.md)).

Since #47: each saved turn carries a UI context (`infrastructure/ui-context.ts`), built in the browser when the prompt is sent: the open panels (`outputs`, `twin`), the organ last clicked on a twin in the chat (the `/twin` card or a `twin.body` view; a click on another part names its system), the chart drawn large in the Outputs panel with its first and last day, and the thread's views, at most four listed by kind and measure, all counted. It holds codes, keys, ids and calendar days only; the schema is closed and refuses anything else, and the block it makes is at most 600 characters. The server writes it to the audit chain as `ui.context` (the context is the row's arguments, so the chain keeps its hash) before the model is called, and a failed write stops the turn. The system prompt gets it only as that block, before any skill section. The response document stores it as `ui_context` and the explainability panel lists it under "On screen when asked". The `ui.context` and skill rows are left out of the document's tool calls, since they read nothing. Incognito turns send none.

Since #388: `show_view` with kind `map.choropleth` maps population estimates by place. It takes no measure, window or numbers: `level` is `world` (every country), `region` (the countries with a value, fitted to them) or `country` with an ISO3 `country` (its states or provinces). The GBD tools are wrapped for the turn (`features/chat/estimate-ledger.ts`) so their rows are kept in memory by tool call; the map draws the latest estimate the turn looked up (one measure, cause, year, sex, age and unit), each location matched to a Natural Earth boundary by code or name (`infrastructure/charts/choropleth/match-location.ts`). A location that matches nothing is listed as not on the map. One audit row, `show_view.map`, names the tool calls drawn and is the view's source. Refusals: `ESTIMATES_REQUIRED`, `COUNTRY_REQUIRED`, `NO_SUBNATIONAL_BOUNDARIES`, `NOTHING_TO_MAP`. The map (`infrastructure/charts/choropleth.tsx`) is our own Equal Earth projection and SVG paths over the committed boundaries (`public/geo/natural-earth/README.md`), loaded on demand; colours are five quantile steps from the card to `--chart-1`, mixed in OKLCH so both themes work, with a hatch for no data. Beside it: the legend with units, the top 10 with 95% uncertainty intervals, a tooltip with value, interval and rank, and a table for screen readers. The places with a value are one listbox: Tab reaches it, arrows and Home and End move by rank. A map is never personal data.

Issues: #35 stored tool parts, #36 `data-view` and `show_view`, #37 Outputs panel, #38 compare, card and table kinds, #39 tool-call cards, #111 clickable numbers, #47 UI context, #48 `twin.body`.

## Incognito chats

Never saved, local only. On an empty new chat the hat-and-glasses switch at the top right ("Incognito chat", `aria-pressed`) opens `/?incognito=1`; turning it off goes back to `/`. A reload keeps the mode but starts an empty conversation, and so do "New chat" and navigating away. Other UI links to `INCOGNITO_HREF` (`infrastructure/incognito.ts`). The banner under the heading reads "Incognito chat. Not saved, not in your threads or search, local models only.", it stays above the answers once there are some, and the prompt bar's frame is dashed.

The conversation lives in the compare screen's React state only (`features/arena/begin-turn.ts`): `startTurn` is never called, the thread history store is not touched, the URL never becomes `/t/<id>`, and no analytics event describes the conversation (with analytics on, the visit to `/?incognito=1` is a page view like any other). Each answer goes to `POST /api/chat/incognito` with a closed body (`modelId`, at most 100 messages, optional `skill`; no turn id). The route needs a signed-in person (or auth off, as `/api/chat`), passes the same abuse protection, and refuses any chat model that is not Ollama on loopback with `INCOGNITO_LOCAL_ONLY` before a model is called. The picker shows the other models greyed out with the reason.

The answer runs through the same pipeline as a saved one: `createStartAnswer` (skill gate, genome rules, data-mode policy) and `createStreamModelResponse` (model, tools, views, stream), with an answer store that writes nothing and analytics that send nothing (`features/chat/incognito-chat.ts`). Exactly what is kept:

- Written: one `audit_events` row per tool call, and `skill.<name>` for a skill turn, as for any chat: actor, a random session id per answer (`incognito-<uuid>`, never a thread or turn id), subject, tool, row count, time, and SHA-256 hashes of the tool's arguments and result. No prompt, answer or thread id. An argument the model writes, such as a knowledge search phrase, is only ever stored as part of that hash.
- Not written: no `threads`, `turns` or `model_responses` row, no stored tool parts or response document, no `prompt_sent`, `model_answered` or generation event. No prompt or answer text goes to a log line; failures log error names and status codes only.
- Read only: the person's user row (never created here), wearable summaries and the sources turned off at `/start`, as a saved turn reads them.

`list_views` and `open_view` find no earlier views, since nothing was stored. Twin notes are never loaded, and `/compact` says there is nothing saved to draft from. The genome tools stay available where the genome policy allows them, because the model is local. Ollama's own logs on this machine are outside TwinLLM.

## Modes and effort

Auto, Manual and Compare, and five effort steps from Quick to Ultra (#366): see
[chat-modes.md](chat-modes.md).

## 2. Skills and the command palette

The slash menu becomes a palette: built-in commands and skills, each showing what it may read. A skill is `skills/<name>/SKILL.md` (name, description, allowed tools, sources, providers, views) plus `evals/`, run in CI like the question set. Built-ins: `/sleep`, `/compact` (a twin note in a per-user memory the person edits), `/report` (PDF or FHIR DocumentReference). `/connect` keeps the wearable rows.

Since #42: the palette lists every offered skill with what it reads and may call, and a prompt sent as `/sleep …` runs under the skill's tool, provider and view allowlists with its instructions in the system prompt. The run is audited as `skill.<name>` and the response document carries `skill` ([skills.md](skills.md)).

Since #43: `/compact` drafts a twin note of a saved thread from the thread's model; the person edits and saves it, reads and edits notes on Customize · Memory, and new threads load them into the system prompt under the permit of the thread they came from ([twin-notes.md](twin-notes.md)).

Issues: #40 palette, #41 skill format, #42 `/sleep`, #43 `/compact`, #44 `/report`.

### Search (#167)

Ctrl/⌘+K anywhere in the shell, or Search in the sidebar, opens one box over threads, pages, docs and `/` commands, with tabs (All, Threads, Pages, Docs, Commands), recent threads and actions when empty, ↑/↓ and Enter, and ←/→ at either end of the text to change the tab. A command opens a new chat with `/name ` typed in; it sends nothing.

- Threads are only the signed-in person's own. Words match titles, prompts and finished answers (Prisma `contains`); meaning matches come from `thread_search_embeddings`, one nomic-embed-text vector per prompt or answer and **no text**, so deleting a thread removes everything search knows about it. The snippet is read back from the turn or answer.
- Embeddings are made only by Ollama on a loopback address, whatever `LOCAL_ONLY` says. Opening the box embeds what is new (at most 25 items or 4 s per call, newest first); with Ollama down, search answers by words and says so.
- A genome thread (#151) is found by its title only: no passage is shown, it is never embedded, and an existing embedding is dropped at the next index run.
- Each thread search is audited as `search.threads` with the tab and the number of words and results, never the query; if the audit cannot be written, the search is refused.
- Docs match by title and by text, with a passage; they are not embedded.

## 3. `/trainer`, descriptive

Daily and weekly views of recovery or readiness, HRV, RHR, sleep and load against the person's 30-day baseline, with goals the person sets. It describes; it does not advise: no training-load suggestion, no red-flag triage, no medical or dose advice. That keeps it inside the intended use. Whoop workouts and the unused Oura mappers (workout, SpO2, stress, VO2max) come first.

Issues: #45 workouts and mappers, #46 `/trainer`. Martin adds his ideas on #46.

## 4. The twin in chat

Each turn carries a short UI context block (open panel, organ, chart range, views), recorded in the audit row. A `twin.body` view focuses the twin on an organ with its biomarker state, and clicking an organ sets the context. A biomarker-to-organ table colours organs by range position. A timeline scrubber replays a day or night with the chart in sync.

Whole-body motion comes in steps: generic clips on the rig (#51 ships a procedural walk and idle with no motion-capture data; any later mocap stays CMU only, since AMASS and SMPL are non-commercial), then clips driven by workouts and sleep, then the person's own gait from pose estimation on the device, then text-to-motion as research. The heart goes from a scaled pulse to four chambers moving in sequence at the measured rate. All of it is labelled a visual cue or a simulation, never the person's physiology.

Issues: #47 context, #48 `twin.body`, #49 organ map, #50 playback, #51 clips, #52 motion from data, #53 heart.

## 5. Monitoring

Opt-in scheduled runs of a skill, a Tasks panel, results as messages in the thread. Off by default, every run audited, notifications only for what the person enabled. Issue #54.

Since #54: Customize · Tasks schedules a skill daily, weekly or every N hours on the person's clock. Each run goes through the same turn pipeline and permits as a typed `/skill` turn, is marked Scheduled in its thread and writes a `task.run` audit row; in personal mode it runs only while unlocked and is otherwise skipped. Notices are in-app and off per task until its bell is on ([skills.md](skills.md#scheduled-tasks)).

## 6. MCP both ways

Out: the nine query tools as an MCP server (the manifest and snapshot exist), same scope and audit rules, personal mode only over local stdio. In: a registry of MCP servers tagged local or remote, policy applied per server; GBD moves onto it. Issues #55 and #56.

## Docs

An in-app Docs page rendering `docs/`: how the twin works, where data goes, what each skill reads, how to read the charts. Short pages, each with a screenshot or live view. Issue #57.

## Research

- Pilot 2 fine-tuning: #31. Pilot 1 learned the templates but reported another code's value for measures it did not know, so pilot 2 adds paraphrases, no-data and unit cases, held-out templates and the app's twelve tools. Later the generator also emits `show_view` and skill conversations.
- Carbon-X as a local DNA helper: #58. Research track for this funding period; the download waits for Peter. Since #105 the app side exists: the Ark report on the Digital Twin page, `genome_report` and `dna_ask` (personal mode with local Ollama and the local sidecar only) and `/genome` ([genome.md](genome.md)).
- Own gait and text-to-motion: #59.
- A `python/` workspace with uv for training, sidecars and analysis: #60.
- LaminDB for lineage of the research pipeline: looked at, not now.

## Phases

| Phase    | What                                         | Issues       |
| -------- | -------------------------------------------- | ------------ |
| 0        | Reproducible eval cohort (#29), scorer (#30) | #33, #31     |
| 1        | Views                                        | #35–#39      |
| 2        | Skills and palette                           | #40–#44      |
| 3        | Workouts and `/trainer`                      | #45, #46     |
| 4        | Twin in chat and in motion                   | #47–#53      |
| 5        | Monitoring                                   | #54          |
| 6        | MCP                                          | #55, #56     |
| Docs     | In-app docs page                             | #57          |
| Research | Pilot 2, Carbon-X, motion spikes, `python/`  | #31, #58–#60 |

Each issue follows the usual flow: branch `<issue>-<slug>`, pull request, all checks green, squash merge.
