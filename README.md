# TwinLLM

Ask questions about health data with open models, side by side, and see which numbers each answer used.

TwinLLM is an open-source research app from the [Open Science Foundation](https://github.com/Opening-Science). It reads wearables, body scans and synthetic patient cohorts, lets up to three open models answer the same question, and shows the tool calls and values behind every answer. Models can run on your own machine. Health data comes in as coded FHIR R4 through [open-twin](https://github.com/Opening-Science/open-twin), the foundation's connector library.

[![CI](https://github.com/Opening-Science/twin-llm/actions/workflows/ci.yml/badge.svg)](https://github.com/Opening-Science/twin-llm/actions/workflows/ci.yml)
[![Licence: Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-blue.svg)](LICENSE)
![Research use only](https://img.shields.io/badge/use-research%20only-lightgrey.svg)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/chat-dark.png">
  <img src="docs/images/chat-light.png" alt="Three local models (qwen3:4b, a TwinLLM fine-tune and qwen3:8b) answering how a synthetic subject's heart rate changed. Each column lists the tools it called with their row counts, then its answer, reasoning, evidence and uncertainty.">
</picture>

> **Research use only.** TwinLLM gives no medical advice and is not for diagnostic use. See [Intended use](#intended-use).

## What it does

- **Answers come from tools, not from memory.** A model never sees raw records. It calls a small set of closed query tools (latest value, trend, baseline, coverage, before and after an event, two wearables compared), and every call lands in an append-only audit log. Each tool call shows as a card above the answer, with the rows it read.
- **Several models, one question.** Up to three models answer side by side, each with its reasoning, cited values and uncertainty. A model that refuses, guesses a code or writes nothing is shown as it happened.
- **Local first.** With `LOCAL_ONLY=true` the models, embeddings and database all run on your machine.
- **Synthetic data to start.** A Synthea cohort ships with setup, so you can try everything, run the evaluation or build training data without a real person's records.

| Page             | What you do there                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chat**         | Ask about a subject's measurements or your own wearables. `/sleep` and `/trainer` run a skill, `/twin` opens the digital twin in the chat, and Ctrl/⌘+K searches threads, pages and docs. |
| **Incognito**    | A chat that is never saved, never indexed for search and only runs on local models.                                                                                                       |
| **Digital Twin** | A 3D body with reference anatomy, live vitals and biomarkers by organ system.                                                                                                             |
| **Customize**    | Your own skills (a form, stored per person), data you import (FHIR records, lab results as CSV, research tables) and connectors (Oura, Whoop, Google Health, BodyLoop).                   |
| **Cohort**       | Browse the synthetic cohort: what is measured, for whom, how often, and the training conversations made from it. Any subject can be asked about in one click.                             |
| **Evaluation**   | Score models on about a hundred questions over the synthetic cohort, with every model call cached for replay.                                                                             |

<p>
  <img src="docs/images/search-light.png" width="49%" alt="The search dialog over a chat: threads matching heart rate, with readable titles, followed by matching docs.">
  <img src="docs/images/incognito-dark.png" width="49%" alt="A new incognito chat in dark mode, with the banner saying it is not saved, not in threads or search, local models only.">
</p>
<p>
  <img src="docs/images/customize-light.png" width="49%" alt="Customize, Skills tab: no own skills yet and a New skill button, then the shipped /genome, /sleep and /trainer skills with what each reads and may call.">
  <img src="docs/images/cohort-light.png" width="49%" alt="The synthetic cohort overview under Customize, Data, with a plain introduction to subjects, observations, LOINC codes, units and cohorts.">
</p>
<p>
  <img src="docs/images/digital-twin-dark.png" width="49%" alt="The Digital Twin page in dark mode: a synthetic demo body at the Skeleton depth with the anatomy panel.">
  <img src="docs/images/connectors-dark.png" width="49%" alt="Customize, Connectors, in dark mode: Oura, Whoop and Google Health cards with their setup status, and BodyLoop under body scan.">
</p>

## Data privacy

Health data is about as sensitive as data gets, and a digital twin puts a lot of it in one place. So the rules are in the code and checked in CI, not on a policy page:

- **Local by default.** With `LOCAL_ONLY=true`, nothing about you needs to leave your machine.
- **No third-party model sees personal data.** OpenRouter, a rented GPU or any other outside model service is refused for anything but synthetic data. Our own Swiss-hosted models get personal data only in an explicitly configured, consented pilot, because whoever runs a GPU host can in principle read its memory.
- **The model reads numbers, not records.** It gets values with units and dates from the query tools. Body scans reach it as measurements only, never as images or meshes.
- **Every read is logged.** Each tool call goes into an append-only, hash-linked audit log, so editing the history shows.
- **Your threads are yours.** A thread opens only for its owner, wearable tokens are encrypted at rest, logs carry no health values or secrets, and analytics (if switched on) carry counts and timings, never questions or answers. Incognito chats are not stored at all.
- **No model of you.** TwinLLM never fine-tunes on one person's data. Training and evaluation use synthetic patients only.

Two problems are still open. Wearable data starts in each vendor's cloud, and nobody yet knows how to measure how much an answer shared with someone else gives away about the one person a twin describes. That second question is what the Open Science Foundation's first funding call is about. The full table is under [What leaves your machine](#what-leaves-your-machine).

## Run it locally

You need [Bun](https://bun.sh) 1.4, Node.js 26, PostgreSQL 16 or newer with [pgvector](https://github.com/pgvector/pgvector), Java 21 (for the Synthea cohort), [uv](https://docs.astral.sh/uv/) (optional: bakes the demo bodies that walk when they cannot be downloaded) and [Ollama](https://ollama.com).

```bash
git clone https://github.com/Opening-Science/twin-llm.git
cd twin-llm
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/twin_llm_synthetic bun run setup:local
ollama pull qwen3:8b && ollama pull nomic-embed-text
bun run dev
```

`setup:local` is safe to re-run; finished steps are skipped. It:

- checks the prerequisites and prints the Homebrew or apt line for anything missing (it never installs system packages);
- writes `.env.local` from `.env.synthetic.example` if there is none, syncs the pinned open-twin packages and installs dependencies;
- creates the database if needed and applies the migrations;
- downloads the anatomy atlases and the rigged demo bodies (baked locally with uv only if the download fails);
- downloads and ingests the synthetic evaluation cohort (Synthea, fixed seed and dates, checksum verified; `-- --generate-cohort` builds it locally instead);
- adds one example thread built from a recorded answer, so you can look around before pulling a model (`-- --skip-example` leaves it out), and a small sample of training conversations for the Cohort page (`-- --skip-training-sample`);
- ends with a checklist of what is ready and what was skipped.

`bun run doctor` prints the same checks without changing anything, including whether `node_modules` and the Prisma client match the repo. `bun run dev` fixes both before it starts. If the evaluation cohort in your database is an older copy, doctor marks it `[stale]` and `bun run setup:local -- --reload-cohort` replaces just that cohort.

On macOS with Homebrew:

```bash
brew install postgresql@18 pgvector openjdk@21 uv
brew services start postgresql@18
export PATH="$(brew --prefix openjdk@21)/bin:$PATH"   # add to ~/.zshrc
bun run setup:local   # without DATABASE_URL it uses postgresql://$USER@127.0.0.1:5432/twin_llm_synthetic
```

Then open <http://localhost:3000>. That runs entirely on your machine against synthetic data, with no account and no cloud keys. `bun run setup:local -- --cohort-10k` loads the 10,000-person cohort instead (about 1 GB to download and 45 GB free while it unpacks). Wearables and everything else: [`docs/runbook.md`](docs/runbook.md).

## How it works

![TwinLLM data flow: wearable, body-scan, guideline and knowledge, population, synthetic and genome lines run from their sources through sync, storage and tools into an open model, which writes the chat answer and runs the synthetic evaluation.](docs/diagrams/data-flow.svg)

Connectors bring data in as coded FHIR R4 observations (LOINC codes, UCUM units) through open-twin, and the warehouse stores them per subject. A chat turn gives the model a fixed system prompt and the query tools. The model calls the tools, and its reply is parsed into a response document with evidence, reasoning, uncertainty and an answer class. In the diagram, solid lines are built and dashed lines are planned.

### What leaves your machine

| Data                                                                 | `LOCAL_ONLY=true`                                                                                                                                                               | Otherwise                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat prompt, wearable summaries, BodyLoop measurements, tool results | Stays: Ollama on `127.0.0.1`                                                                                                                                                    | Sent to the configured provider (our own models on Exoscale in Switzerland by default). Personal data goes only to local Ollama, or to Exoscale only with `EXOSCALE_PERSONAL_DATA=consented-pilot`; OpenRouter, Infomaniak and the remote GPU only for synthetic data |
| Guideline embeddings                                                 | Stays: Ollama on this machine                                                                                                                                                   | Stays unless `OLLAMA_BASE_URL` points elsewhere                                                                                                                                                                                                                       |
| Wearable data                                                        | Downloaded from each vendor's cloud over OAuth                                                                                                                                  | Same                                                                                                                                                                                                                                                                  |
| Population data (GBD)                                                | Refused at startup                                                                                                                                                              | Query sent to the remote GBD server when configured                                                                                                                                                                                                                   |
| Analytics (PostHog), when a key is set                               | Refused at startup                                                                                                                                                              | Server events with ids, counts and timings to PostHog (EU host by default); never prompt or answer text. Model-call metrics only when `DATA_MODE=synthetic`. Browser analytics only with `NEXT_PUBLIC_POSTHOG_BROWSER=true`                                           |
| Auth and abuse protection (Clerk, Arcjet)                            | Refused at startup                                                                                                                                                              | Used when their keys are set                                                                                                                                                                                                                                          |
| BodyLoop scan                                                        | Local network only                                                                                                                                                              | Same                                                                                                                                                                                                                                                                  |
| Genome (Ark)                                                         | Stays on the device. Only the report the owner approves on their phone is stored here, read by local Ollama and the local Carbon-X sidecar ([`docs/genome.md`](docs/genome.md)) | Same                                                                                                                                                                                                                                                                  |
| Tokens, FHIR bundles, raw vendor payloads, scan mesh and markers     | Never leave                                                                                                                                                                     | Never leave                                                                                                                                                                                                                                                           |

Details: [`docs/providers.md`](docs/providers.md).

### Models

| `LLM_PROVIDER`                                | Notes                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ollama` (**default with `LOCAL_ONLY=true`**) | Local models on this machine, including MedGemma                                                    |
| `exoscale` (**default otherwise**)            | Our own open models on vLLM, on an Exoscale GPU instance in Switzerland; needs `EXOSCALE_BASE_URLS` |
| `openrouter`                                  | Free OSS (`*:free`), only when `DATA_MODE=synthetic` and no snapshot                                |
| `remote-gpu`                                  | Your own vLLM (e.g. Apertus) over an SSH tunnel, synthetic data only                                |
| `infomaniak` (legacy)                         | Swiss-hosted OSS, OpenAI-compatible (cloud); only when named, never a default; synthetic data only  |

The open-model lineup for comparisons is in [`docs/models.md`](docs/models.md).

### Connectors

| Connector     | Notes                                           | Local helper                                           |
| ------------- | ----------------------------------------------- | ------------------------------------------------------ |
| Oura          | `features/oura/`, `/api/oura/*`                 | `bun run oura:proxy` (:8787)                           |
| Whoop         | `features/whoop/` + `@open-twin/provider-whoop` | `bun run whoop:proxy` (:8788), local certificate first |
| Google Health | Fitbit-linked Google account                    | `bun run google-health:setup`                          |

## Evaluation

About a hundred questions (`evaluation/questions.v1.json`) over six synthetic scenarios, scored on correctness, hallucination, privacy, query safety, clinical caution, readability, consistency and latency. The answer key is built from the cohort with the same tools the models call.

```bash
bun run eval -- --models ollama:qwen3:4b --latency-set
bun run eval:report -- <run-id>
```

Every model call is cached, so `--replay` re-scores a run without a GPU. Details: [`docs/evaluation/harness.md`](docs/evaluation/harness.md).

## Project layout

| Path              | What lives there                                                                  |
| ----------------- | --------------------------------------------------------------------------------- |
| `app/`            | Next.js routes and API handlers                                                   |
| `features/`       | One folder per feature: chat, search, skills, digital twin, connectors, cohort, … |
| `infrastructure/` | Environment, database, analytics, auth and shared UI primitives                   |
| `packages/`       | Query tools, warehouse, biomarkers, guidelines, knowledge, BodyLoop client        |
| `scripts/`        | Synthea, ingest, evaluation and training-data command lines                       |
| `docs/`           | Design notes, runbook and reference                                               |

## Contributing

Contributions are welcome, from a typo to a new connector. Good places to start:

- issues labelled [`good first issue`](https://github.com/Opening-Science/twin-llm/labels/good%20first%20issue) and [`help wanted`](https://github.com/Opening-Science/twin-llm/labels/help%20wanted);
- trying the quick start on your machine and telling us what was unclear;
- adding questions or scenarios to the evaluation set.

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [`SECURITY.md`](SECURITY.md), never in a public issue. Questions and ideas go to [Discussions](https://github.com/Opening-Science/twin-llm/discussions).

TwinLLM is maintained by [Peter Dike](https://github.com/CPD9) for the Open Science Foundation. If you use it in your work, please cite it ([`CITATION.cff`](CITATION.cff)).

## Intended use

TwinLLM is experimental software for **research use only**: n-of-1 hypothesis generation and the evaluation of open language models on coded health data. It is not a medical device and is not offered for clinical or consumer health use.

**Medical use is outside the intended scope.** TwinLLM, its chat answers, cited evidence, body-twin views and evaluation results must not be used for medical advice, diagnosis or diagnostic support, disease prediction or prevention, clinical monitoring, triage, treatment or any other medical decision.

Model output can be wrong, incomplete or invented even when it cites sources. It is a research output, not a clinically validated assessment; it must not guide care or replace a qualified health professional.

Regulatory status depends on actual functions, intended purpose and claims. A research label, the `not_for_diagnostic_use=true` flag on each reply or a component boundary does not exempt medical functionality. This repository claims no medical-device certification or clearance. `bun run lint:claims` checks the interface's own copy for medical-purpose wording in CI. That check is a floor, not a certificate.

A deployment that connects real wearable, scan or genome data handles health data. Operators are responsible for consent, data protection, ethics approval where required and the regulatory status of their deployment. Before handling participant data, read open-twin's [intended use and integration responsibilities](https://github.com/Opening-Science/open-twin/blob/main/docs/INTENDED-USE.md).

The software is supplied under the warranty and liability terms of its [licence](LICENSE), subject to applicable law. This section does not change that licence or certify compliance.

## Related projects

- [Open Wearables](https://github.com/the-momentum/open-wearables): wearable interchange. TwinLLM reads coded FHIR R4 through open-twin instead of a separate interchange format.
- [omh-shim](https://github.com/jupyterhealth/omh-shim) and [JupyterHealth](https://jupyterhealth.org): [Open mHealth](https://www.openmhealth.org/), optionally wrapped in FHIR. open-twin writes coded FHIR R4 Observations (LOINC and UCUM).
- [HealthKitOnFHIR](https://github.com/StanfordBDHG/HealthKitOnFHIR): Apple HealthKit to FHIR on the device. TwinLLM is the server side for Oura, Whoop and Google Health.

## Licence

[Apache-2.0](LICENSE) covers TwinLLM original work. The Open Science Foundation logo, the CC BY 4.0 knowledge notes, the open-twin and open-twin-xr code (MIT) and the downloaded anatomy assets keep their own terms; see [`NOTICE`](NOTICE). Vendor names identify independent integrations and do not imply endorsement.
