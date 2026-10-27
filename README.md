# TwinLLM

**Ask questions about health data with open language models, and see exactly which numbers every answer used.**

TwinLLM is an open-source research application by the [Open Science Foundation](https://github.com/Opening-Science). It connects wearables, body scans and synthetic patient cohorts to open models you can run on your own machine, lets several models answer the same question side by side, and shows the evidence behind every answer. It is built on [open-twin](https://github.com/Opening-Science/open-twin), the foundation's library of health-data connectors to coded FHIR R4.

[![CI](https://github.com/Opening-Science/twin-llm/actions/workflows/ci.yml/badge.svg)](https://github.com/Opening-Science/twin-llm/actions/workflows/ci.yml)
[![Licence: Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-blue.svg)](LICENSE)
![Research use only](https://img.shields.io/badge/use-research%20only-lightgrey.svg)

![Two open models answering the same question about one synthetic subject side by side. Each answer shows the values it used, the data tools it called, its reasoning and how uncertain it is.](docs/images/compare-light.png)

> **Research use only.** TwinLLM gives no medical advice and is not for diagnostic use. See [Intended use](#intended-use).

## Why TwinLLM

Language models are good at sounding sure. Health data needs the opposite: numbers you can trace, units you can trust, and a model that says "not enough data" when that is the honest answer. TwinLLM is a place to work on that in the open:

- **Every number has a source.** Models do not read raw records. They call a small set of closed query tools (latest value, trend, baseline, coverage, comparison) over coded observations, and every call is written to an append-only audit log.
- **Open models, side by side.** Ask one question and get answers from up to three models, each with its reasoning, cited values and uncertainty, so you can compare them on the same footing.
- **Local first.** With `LOCAL_ONLY=true`, models, embeddings and storage all stay on your machine.
- **Honest by design.** Answers that do not rest on enough data are withheld, missing values are never turned into zero, and the interface copy is checked in CI for medical claims.
- **Synthetic data to start with.** A built-in Synthea cohort lets anyone try the full app, run the evaluation or build training data without touching a real person's records.

## Data privacy

Health data is among the most sensitive data a person has, and a digital twin concentrates
it in one place. TwinLLM is built so that privacy does not depend on a policy page or on
trusting an operator: the rules below are enforced by the code, checked by tests in CI, and
visible in the source for anyone to audit.

- **Local by default.** With `LOCAL_ONLY=true`, the models, the embeddings and the database
  all run on your own machine. Nothing about you needs to leave it.
- **No third-party model ever sees personal data.** External model services, such as
  OpenRouter or a rented GPU, are refused for anything but synthetic data. Our own
  Swiss-hosted models receive personal data only in an explicitly configured, consented
  pilot, because the operator of a hosted GPU can in principle read a running machine's
  memory.
- **The model never reads your raw records.** It works through a small set of closed query
  tools that return numbers with their units and dates, and body-scan data reaches it only
  as numeric measurements, never as images or meshes.
- **Every data read is on the record.** Each query a model makes is written to an
  append-only, hash-linked audit log, so tampering with the history is detectable.
- **Your conversations are yours.** Threads open only for their owner, wearable tokens are
  encrypted at rest, logs are kept free of health values and secrets, and analytics, if
  enabled at all, carry counts and timings, never your questions or answers.
- **No model of you.** TwinLLM never fits or fine-tunes a model on one person's data, so
  there is no per-person model that could memorise and leak that person. It answers
  through audited queries over the person's own record. Development, evaluation and
  training use synthetic patients generated with Synthea.

What remains unsolved is just as important to say. Wearable data still originates in each
vendor's cloud, and no one, including us, can yet measure how much an answer or insight
shared with a third party discloses about the one person a twin describes. That open problem
is the focus of the Open Science Foundation's first funding call. The full data-flow table is under
[What leaves your machine](#what-leaves-your-machine).

## What you can do with it

|                   |                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Chat**          | Ask about one subject's measurements with optional wearable context; compare up to three open models.                        |
| **Digital Twin**  | Explore a 3D body with reference anatomy, live vitals and biomarkers lit by organ system.                                    |
| **Data**          | Browse the synthetic cohort: what is measured, how often, for whom, and the training conversations made from it.             |
| **Connectors**    | Link Oura, Whoop and Google Health, a BodyLoop body scanner, and knowledge sources.                                          |
| **Get started**   | A short first-run flow: what you are here for, which data to connect, which sources the model may use, where your data goes. |
| **Evaluation**    | Score models on 81 questions over the synthetic cohort, with every model call cached for replay.                             |
| **Training data** | Turn synthetic cohorts into tool-use conversations for fine-tuning open models.                                              |

<p>
  <img src="docs/images/digital-twin-dark.png" width="49%" alt="The Digital Twin page in dark mode: a synthetic demo body at the Skeleton depth with the depth slider and the Biomarkers panel.">
  <img src="docs/images/data-light.png" width="49%" alt="The Data page: a plain-language introduction to the synthetic cohort, with what a subject, an observation, a LOINC code, a unit and a cohort mean.">
</p>
<p>
  <img src="docs/images/start-light.png" width="49%" alt="The first-run flow asking what brings you here, with roles to pick and a choice between the synthetic demo cohort and your own data.">
  <img src="docs/images/connectors-dark.png" width="49%" alt="The Connectors page in dark mode, with cards for Oura, Whoop, Google Health, BodyLoop, GBD and Guidelines, each showing its setup status.">
</p>

## Run it locally

You need [Bun](https://bun.sh) 1.4, Node.js 26, PostgreSQL 16 or newer with [pgvector](https://github.com/pgvector/pgvector), Java 21 (for the Synthea cohort), [uv](https://docs.astral.sh/uv/) (optional: bakes the demo bodies that walk when they cannot be downloaded) and [Ollama](https://ollama.com).

```bash
git clone https://github.com/Opening-Science/twin-llm.git
cd twin-llm
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/twin_llm_synthetic bun run setup:local
ollama pull qwen3:8b && ollama pull nomic-embed-text
bun run dev
```

`setup:local` checks the prerequisites and prints the Homebrew or apt line for anything missing (it never installs system packages). It then writes `.env.local` from `.env.synthetic.example` if there is none, syncs the pinned open-twin packages, installs dependencies, creates the database if it does not exist, applies the migrations, downloads the anatomy atlases and the rigged demo bodies (from the `anatomy-rigged-v1` release; baked with uv only if that fails), and downloads and ingests the 30-person synthetic evaluation cohort (Synthea, fixed seed and dates, from the `eval-cohort-v1` release, checksum verified; `-- --generate-cohort` generates it locally instead, which gives the pinned files on x86_64 only). It is safe to re-run: finished steps are skipped. It ends with a checklist of what is ready and what was skipped and why. An evaluation cohort in the warehouse that is not the pinned one (an older copy with 35 subjects instead of 37) is marked `[stale]`; `bun run setup:local -- --reload-cohort` replaces that cohort's warehouse rows and nothing else. `bun run doctor` prints the same checks and what each page needs, without changing anything.

On macOS with Homebrew:

```bash
brew install postgresql@18 pgvector openjdk@21 uv
brew services start postgresql@18
export PATH="$(brew --prefix openjdk@21)/bin:$PATH"   # add to ~/.zshrc
bun run setup:local   # without DATABASE_URL it uses postgresql://$USER@127.0.0.1:5432/twin_llm_synthetic
```

`bun run setup:local -- --cohort-10k` loads the 10,000-person cohort from the [`cohort-synthea-v4-seed42-10k`](https://github.com/Opening-Science/twin-llm/releases/tag/cohort-synthea-v4-seed42-10k) release instead (about 1 GB download and 45 GB free disk while it unpacks). Open <http://localhost:3000>. This runs fully on your machine against synthetic data: no account, no cloud keys. Wearables and the rest: [`docs/runbook.md`](docs/runbook.md).

## How it works

![TwinLLM data flow: wearable, body-scan, guideline and knowledge, population, synthetic and genome lines run from their sources through sync, storage and tools into an open model, which writes the chat answer and runs the synthetic evaluation.](docs/diagrams/data-flow.svg)

Connectors bring data in as coded FHIR R4 observations (LOINC codes, UCUM units) through open-twin. The warehouse stores them per subject. A chat turn gives the model a fixed system prompt and the closed query tools; the model calls them, and the answer is parsed into a response document with its evidence, reasoning, uncertainty and answer class. Solid lines in the diagram are built; dashed lines are planned.

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
| `openrouter`                                  | Free OSS (`*:free`) — only when `DATA_MODE=synthetic` and no snapshot                               |
| `remote-gpu`                                  | Your own vLLM (e.g. Apertus) over an SSH tunnel — synthetic data only                               |
| `infomaniak` (legacy)                         | Swiss-hosted OSS, OpenAI-compatible (cloud); only when named, never a default; synthetic data only  |

The open-model lineup for comparisons is in [`docs/models.md`](docs/models.md).

### Connectors

| Connector     | Notes                                           | Local helper                                           |
| ------------- | ----------------------------------------------- | ------------------------------------------------------ |
| Oura          | `features/oura/`, `/api/oura/*`                 | `bun run oura:proxy` (:8787)                           |
| Whoop         | `features/whoop/` + `@open-twin/provider-whoop` | `bun run whoop:proxy` (:8788), local certificate first |
| Google Health | Fitbit-linked Google account                    | `bun run google-health:setup`                          |

## Evaluation

81 questions over six synthetic scenarios, scored on eight criteria: correctness, hallucination, privacy, query safety, clinical caution, readability, consistency and latency. The answer key comes from the synthetic cohort through the same closed tools the models call.

```bash
bun run eval -- --models ollama:qwen3:4b --latency-set
bun run eval:report -- <run-id>
```

Every model call is cached, so `--replay` re-scores a run without a GPU. Details: [`docs/evaluation/harness.md`](docs/evaluation/harness.md).

## Project layout

| Path              | What lives there                                                                     |
| ----------------- | ------------------------------------------------------------------------------------ |
| `app/`            | Next.js routes and API handlers                                                      |
| `features/`       | One folder per feature: chat, digital twin, connectors, data explorer, onboarding, … |
| `infrastructure/` | Environment, database, analytics, auth and shared UI primitives                      |
| `packages/`       | Query tools, warehouse, biomarkers, guidelines, knowledge, BodyLoop client           |
| `scripts/`        | Synthea, ingest, evaluation and training-data command lines                          |
| `docs/`           | Design notes, runbook and reference                                                  |

## Contributing

Contributions are welcome, from a typo fix to a new connector. Good places to start:

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

- [Open Wearables](https://github.com/the-momentum/open-wearables) — wearable interchange work. TwinLLM consumes coded FHIR R4 via open-twin rather than a parallel interchange format.
- [omh-shim](https://github.com/jupyterhealth/omh-shim) / [JupyterHealth](https://jupyterhealth.org) — produce [Open mHealth](https://www.openmhealth.org/), optionally wrapped in FHIR. open-twin produces coded FHIR R4 Observations (LOINC + UCUM).
- [HealthKitOnFHIR](https://github.com/StanfordBDHG/HealthKitOnFHIR) — Apple HealthKit to FHIR on device. TwinLLM is a server-side companion for Oura, Whoop, and Google Health.

## Licence

[Apache-2.0](LICENSE) covers TwinLLM original work. The Open Science Foundation logo, the CC BY 4.0 knowledge notes, the open-twin and open-twin-xr code (MIT) and the downloaded anatomy assets keep their own terms; see [`NOTICE`](NOTICE). Vendor names identify independent integrations and do not imply endorsement.
