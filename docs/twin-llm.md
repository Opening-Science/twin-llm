# TwinLLM (Open Science Foundation)

Application companion to open-twin: coded FHIR R4 in, cited evidence out. A question goes to one research specialist (Auto), to the specialists and models a person picks (Manual) or to two or three models side by side (Compare), with optional wearable context and explainability scaffolding. Personal data stays on the person's machine.

Research use only; nothing here is clinical advice. Where the chat goes next: [`chat-platform.md`](chat-platform.md).

## What is in the app

Each line links to the page with the detail; this page does not repeat it.

| Area                  | What it does                                                                                                                                                            | Read                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Chat modes and effort | Auto, Manual and Compare; five effort steps from Quick to Ultra that set thinking, model calls and a number check (#366)                                                | [chat-modes.md](chat-modes.md)                                                                        |
| Query tools           | Closed, audited reads over the Synthea warehouse and the turn's wearable snapshots                                                                                      | [query-layer.md](query-layer.md)                                                                      |
| Privacy               | Owner-only storage, passphrase unlock, encryption at rest, consent before learning, a disclosure ledger that blocks genome identifiers to hosted models, signed anchors | [privacy-design.md](privacy-design.md), [providers.md](providers.md#what-leaves-the-host)             |
| Your own data         | FHIR records, lab CSV and research tables imported on Customize · Data                                                                                                  | [personal-data.md](personal-data.md)                                                                  |
| Population context    | IHME GBD 2023 imported on this machine, `gbd_estimate`, `/profile`, choropleth maps by country or state                                                                 | [gbd.md](gbd.md), [gbd-map-coverage.md](gbd-map-coverage.md)                                          |
| Live public lookups   | PubMed and Ensembl, off until switched on per source, recorded in the ledger (#6)                                                                                       | [providers.md](providers.md#live-public-lookups)                                                      |
| Skills and tasks      | Shipped and own skills; scheduled tasks on Customize · Tasks, none by default (#54)                                                                                     | [skills.md](skills.md), [scheduled tasks](skills.md#scheduled-tasks)                                  |
| Twin notes            | `/compact` notes holding only what the person confirmed                                                                                                                 | [twin-notes.md](twin-notes.md)                                                                        |
| Lab                   | Self-checks, long-job status (#310), evaluation and benchmark results, the blind second rater                                                                           | [lab.md](lab.md), [evaluation/second-rater.md](evaluation/second-rater.md)                            |
| Evaluation            | The harness, scenarios and question sets on synthetic cohorts; the first full runs                                                                                      | [evaluation/harness.md](evaluation/harness.md), [eval-runs-2026-10.md](research/eval-runs-2026-10.md) |
| Intended use          | What TwinLLM is for and what would make it a device                                                                                                                     | [clinical-research.md](clinical-research.md)                                                          |

## Quick start (local MVP)

For the synthetic demo on a fresh machine, `bun run setup:local` does the setup in one step (README, "Run it locally"). By hand, for your own data:

```bash
bun install
cp .env.example .env.local
# Minimum: DATABASE_URL + ollama (LOCAL_ONLY=true, the .env.example default)
# or EXOSCALE_BASE_URLS with LOCAL_ONLY=false (exoscale is then the default)
# Keep LOCAL_MVP=true and AUTH_DISABLED=true for no-login local runs
# DATA_MODE=synthetic | personal (default personal)
bun run db:push
bun run dev
```

Open http://localhost:3000 — no Clerk login required in local MVP mode.

## First run

A person who has not finished or skipped setup and has no thread yet is sent from `/` to `/start`. Someone who already has a thread counts as set up. Five steps, one question each, every one skippable:

1. **What brings you here**: roles (researcher, clinician-researcher, self-tracker, student) and the synthetic demo cohort or own data. Tailors the starter questions.
2. **Connect your data**: Oura, Whoop, Google Health, BodyLoop and Ark with their real state. Link opens the same authorize route as Connectors; setups that need more go to the Connectors page.
3. **Knowledge sources**: guideline passages, OpenTwin knowledge notes, the synthetic cohort tools and GBD, with a switch per group and per source. A source that is off loses its chat tools and its line in the system prompt. Trends and baselines need Subjects and observations (they take its `subject_ref` values), so turning records off turns them off too. Sources that cannot answer on this server (empty index, personal mode, GBD pending) show why instead of a switch.
4. **Where your data goes**: the env-driven provider setting, read-only, and what leaves this machine ([providers.md](providers.md#what-leaves-the-host)).
5. **What do you want to explore**: a hint under the box says to leave out personal details and where the text goes. Three starter questions from the configured model, or fixed starters per role when the call fails or takes over 40 s. Picking one opens a new thread on the default models.

Answers live in `onboarding_profiles`, one row per user. "Get started" in the sidebar reopens the flow on the saved answers.

## Suggested questions

A new, empty chat shows up to five question chips above the prompt (`/api/chat/suggestions`, `features/arena/suggested-questions.ts`). They come from fixed templates, one per measure family that has data, so a chip never asks about data that is not there. No model writes them.

- `DATA_MODE=synthetic`: the Demo's first synthetic person (Synthetic person 1, first by `subject_ref`), read with the `coverage` query tool over the families' LOINC codes. The chip shows "their …" under the person's name; the prompt names the `subject_ref`.
- `DATA_MODE=personal`: the linked Oura, Whoop and Google Health snapshots, read with `wearable_coverage` (the same coverage maths, over the snapshot's keys).

Families with the most readings come first, ties in a fixed order. A trend question needs three readings, otherwise it asks for the latest value. Labs only ask for the latest value. With ten or more readings the busiest family that can be drawn also gets a chart question, last. Both reads are audited like any tool call, with the actor as session. A subject with no rows, or nothing linked, gets no chips. A chip writes its question into the prompt and does not send it. The chips are gone once the thread has a turn.

## LLM providers

| `LLM_PROVIDER`                            | What it uses                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ollama` (default with `LOCAL_ONLY=true`) | Local models at `OLLAMA_BASE_URL`, including MedGemma                                          |
| `exoscale` (default otherwise)            | Our own open models on vLLM, on an Exoscale GPU instance in Switzerland                        |
| `openrouter`                              | Free OSS models (`*:free`) — only when `DATA_MODE=synthetic`, no snapshot                      |
| `remote-gpu`                              | vLLM on a rented GPU over an SSH tunnel — synthetic data only                                  |
| `infomaniak` (legacy)                     | Infomaniak AI (Swiss-hosted OSS, cloud); only when named, never a default; synthetic data only |

Exoscale: set `EXOSCALE_BASE_URLS` (one vLLM `/v1` URL per GPU); without it, startup fails when `LOCAL_ONLY=false`. Setup and data policy: [providers.md](providers.md#exoscale).

## Wearables

- **Oura** — implemented (`features/oura/`, `/api/oura/*`); local redirect proxy `bun run oura:proxy` on :8787
- **Whoop** — implemented (`features/whoop/`, `/api/whoop/*`) using `@open-twin/provider-whoop`; HTTPS redirect via `bun run whoop:proxy` on :8788 (`certificates/*.pem` locally, not committed)
- **Google Health** — Fitbit-linked Google account (`features/google-health/`, `/api/google-health/*`); `bun run google-health:setup`

## Privacy

- `DATA_MODE=synthetic` — OpenRouter allowed when no wearable snapshot is linked
- `DATA_MODE=personal` — default; live wearable narratives in prompts; OpenRouter blocked at env parse, chat resolve, and the request-level permit. The chat's query tools read no synthetic subject in this mode
- The synthetic cohort explorer (Customize · Data, `/customize/data/cohort`) and the Body twin's Demo lab values show the synthetic cohorts in both modes, labelled "Synthetic data". They read through a separate synthetic display scope that can only select `is_synthetic` rows of allowlisted cohorts and sends nothing to a model ([warehouse.md](warehouse.md#synthetic-display-scope))
- Files you import on Customize · Data (FHIR records, lab CSV, research tables) are stored only with `DATA_MODE=personal`, in their own `personal_*` tables, audited without values, and never sent to a hosted model ([personal-data.md](personal-data.md))
- GBD Results Tool files you import on Customize · Data are population estimates, not personal data; they work in both modes on a local install, and every import and delete is audited without values ([gbd.md](gbd.md#import-from-customize--data))
- Threads are private in both modes. `/t/<id>` opens only for the person who wrote the thread; anyone else, signed in or not, gets the same 404 as an unknown id (`features/arena/owned-thread.ts`). There is no sharing: "Copy link" copies the address for the owner's own use, and its analytics event carries no thread id. Delete in the thread bar takes the thread out of the sidebar at once and becomes Undo for five seconds; when that runs out, `DELETE /api/threads/<id>` deletes the thread with its turns, answers and search embeddings, writes one audit row (`thread.delete`, the number of turns) and the page goes to a new chat. Going to another page inside the window deletes it then; closing or reloading the tab inside it makes the browser ask, and leaving anyway keeps the thread. A withheld answer's text and reasoning are not sent to the browser when a saved thread loads. Below 768px wide the thread bar folds PDF, Download, Copy link and Delete into one menu behind a "…" button and the title truncates; arrow keys, Home and End move through the menu, and it stays open while Delete waits out its undo window (#378).
- New in the sidebar (and every other link to `/`) always opens an empty conversation with no thread id, also right after a first send on `/` has moved the address to `/t/<id>` and while its answers are still streaming (#377, `features/arena/new-conversation.ts`). Answers already streaming finish on the server and show when the thread is reopened.
- Twin notes (`/compact`, Customize · Memory) hold only what the person confirmed: topics, measures with the tool and dates, open questions; no tool rows. Each keeps the permit of its thread: synthetic notes load into synthetic turns only, personal notes only on a provider allowed personal data, notes from a genome or imported-data thread only on Ollama on this machine. Writing, editing, deleting and loading are audited ([twin-notes.md](twin-notes.md))
- Scheduled tasks (Customize · Tasks, #54) run a skill into a saved thread under the same policy as a typed turn; nothing is scheduled by default, a personal-mode run happens only while unlocked (otherwise "Skipped: locked"), every run is audited, and notices stay in the app and are off until a task's bell is on ([skills.md](skills.md#scheduled-tasks))
- With `DATA_MODE=personal` the privacy layer of [privacy-design.md](privacy-design.md) applies: the server starts only on owner-only storage (#144), personal data stays locked until the passphrase unlocks it (#142) and is encrypted at rest (#141), nothing learns from it without a consent per use (#145), every send off this machine is written to the disclosure ledger first and a hosted model request holding identifiers from the person's genome files is not sent (#140, #356), and the audit and ledger chain heads are signed (#300)
- Live PubMed and Ensembl lookups are off until the person switches each source on, are refused with `LOCAL_ONLY=true` and in incognito chats, and send search terms, never a stored value ([providers.md](providers.md#live-public-lookups))
- Incognito chats (`/?incognito=1`) are never saved and run only on Ollama on loopback: no thread, turn or answer row, no thread history entry, no analytics event about the conversation, and no prompt or answer text in a log. Tool reads are audited as usual, under a random session id per answer with no thread or turn id ([chat-platform.md](chat-platform.md#incognito-chats))

## Key paths

| Area                         | Path                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Env / local MVP / DATA_MODE  | `infrastructure/env.ts`, `infrastructure/data-mode.ts`                                  |
| Actor (auth bypass)          | `infrastructure/auth-actor.ts`                                                          |
| Providers                    | `features/chat/resolve-language-model.ts`                                               |
| Catalog                      | `infrastructure/fetch-model-catalog.ts`                                                 |
| Oura / Whoop / Google Health | `features/oura/`, `features/whoop/`, `features/google-health/`                          |
| System prompt / XAI          | `features/chat/twin-system-prompt.ts`                                                   |
| Twin notes (`/compact`)      | `infrastructure/twin-notes.ts`, `features/memory/`                                      |
| Scheduled tasks              | `features/tasks/`, `features/arena/scheduled-turn.ts`                                   |
| First run (`/start`)         | `features/onboarding/`, `infrastructure/knowledge-sources.ts`                           |
| Chat modes and effort        | `features/arena/chat-mode.ts`, `infrastructure/chat-effort.ts`                          |
| Unlock, consent, ledger      | `infrastructure/vault-*.ts`, `features/privacy/`, `infrastructure/disclosure-ledger.ts` |
| GBD local store              | `packages/gbd-local/`, `scripts/gbd/`                                                   |
| Live lookups                 | `packages/live-sources/`                                                                |
| Docs (`/docs`)               | `features/docs/`: these pages rendered from `docs/*.md`                                 |
| Lab (`/lab`)                 | `features/lab/`: a hub of cards, one page per experiment ([lab.md](lab.md))             |
| open-twin pins               | `.open-twin/` via `bun run sync:open-twin` (`PROVENANCE.md`)                            |
