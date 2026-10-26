# TwinLLM (Open Science Foundation)

Application companion to open-twin: coded FHIR R4 in, cited evidence out. Several models answer the same question side by side, with optional wearable context and explainability scaffolding.

Research-use visualisation only. Where the chat goes next: [`chat-platform.md`](chat-platform.md).

## Quick start (local MVP)

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
4. **Where your data goes**: the env-driven provider setting, read-only, and what leaves this machine (README "What leaves this machine").
5. **What do you want to explore**: a hint under the box says to leave out personal details and where the text goes. Three starter questions from the configured model, or fixed starters per role when the call fails or takes over 40 s. Picking one opens a new thread on the default models.

Answers live in `onboarding_profiles`, one row per user. "Get started" in the sidebar reopens the flow on the saved answers.

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
- `DATA_MODE=personal` — default; live wearable narratives in prompts; OpenRouter blocked at env parse, chat resolve, and the request-level permit
- Threads are private in both modes. `/t/<id>` opens only for the person who wrote the thread; anyone else, signed in or not, gets the same 404 as an unknown id (`features/arena/owned-thread.ts`). There is no sharing: "Copy link" copies the address for the owner's own use, and its analytics event carries no thread id. A withheld answer's text and reasoning are not sent to the browser when a saved thread loads.

## Key paths

| Area                         | Path                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| Env / local MVP / DATA_MODE  | `infrastructure/env.ts`, `infrastructure/data-mode.ts`         |
| Actor (auth bypass)          | `infrastructure/auth-actor.ts`                                 |
| Providers                    | `features/chat/resolve-language-model.ts`                      |
| Catalog                      | `infrastructure/fetch-model-catalog.ts`                        |
| Oura / Whoop / Google Health | `features/oura/`, `features/whoop/`, `features/google-health/` |
| System prompt / XAI          | `features/chat/twin-system-prompt.ts`                          |
| First run (`/start`)         | `features/onboarding/`, `infrastructure/knowledge-sources.ts`  |
| Docs (`/docs`)               | `features/docs/`: these pages rendered from `docs/*.md`        |
| open-twin pins               | `.open-twin/` via `bun run sync:open-twin` (`PROVENANCE.md`)   |
