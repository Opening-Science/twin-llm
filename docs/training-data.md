# Training data

Groundwork for fine-tuning an open model on TwinLLM's tool use. Nothing
here trains a model yet. It builds the cohorts, the synthetic wearable series
and the example conversations a training run would read.

## Purpose

The conversations teach behaviour, not medical knowledge:

- **Tool use.** Pick the right closed query tool, with valid arguments, and
  read the record window first when the question is about "the last five
  years".
- **Refusals.** Open with `REFUSE:` for a dose, a medicine change or a
  question about whether someone has a condition. Call no tool for other
  people. Report a tool refusal (`SUBJECT_SCOPE_VIOLATION`, `MIXED_UNITS`)
  in plain words.
- **Honest uncertainty.** Say "no rows" or "too few readings" instead of a
  number, and never turn a missing value into zero.

Every number in an answer was returned by the real closed tools
(`packages/query-tools`) on the given cohort. No model wrote any answer
text: the answers come from fixed templates filled with tool results. The
four headings follow the Twin system prompt and `docs/response-schema.md`.
Numbers, units and dates go through `infrastructure/format-measure.ts`.

## Synthetic only

Synthetic or Demo data only. The cohorts come from
Synthea, the wearable series from a seeded generator, and the subjects are
named by `subject_ref` only. Never point these scripts at a database that
holds a real person's rows, a connected wearable or the Self subject. The
generator refuses to run unless `DATA_MODE=synthetic`, reads only allowlisted
synthetic cohorts, and the wearable generator reads only Synthea bundles.

## Cohorts

`bun run synthea:generate -- --preset <name>` (presets in
`scripts/synthea/cohort-presets.ts`; flags `--population`, `--seed`, `--age`
override them, and `--dry-run` prints the settings without running Java).

| Preset     | Cohort id             | N      | Seed | Ages  | Role                                     |
| ---------- | --------------------- | ------ | ---- | ----- | ---------------------------------------- |
| `training` | `synthea-v4-seed4242` | 10,000 | 4242 | 40–75 | Training conversations                   |
| `held-out` | `synthea-v4-seed9001` | 1,000  | 9001 | 40–75 | Test conversations                       |
| `eval`     | `synthea-v4-seed42`   | 30     | 42   | 40–75 | The evaluation question set, never train |

Without a preset the defaults are unchanged (N=10, seed 42, `.synthea/fhir`).

### The 1M cohort

One million patients as 100 batches of 10,000, made outside this repository
by a batch script that calls the same Synthea v4.0.0 recipe (open-twin's
`tools/synthea`) once per batch and keeps one `batch-NNN.tar.zst` and
`batch-NNN.manifest.json` per batch. Each batch is its own cohort, named by
its seed (`SYNTHEA_1M_BATCHES` in `scripts/synthea/cohort-presets.ts`):

| Cohort ids                                    | N per batch | Seed      | Clinician seed | Ages | Role     |
| --------------------------------------------- | ----------- | --------- | -------------- | ---- | -------- |
| `synthea-v4-seed1001` … `synthea-v4-seed1099` | 10,000      | 1001–1099 | seed + 1000    | all  | Training |
| `synthea-v4-seed1100`                         | 10,000      | 1100      | 2100           | all  | Held-out |

Massachusetts, `batch-NNN` is seed − 1000. Synthea also exports the deceased,
so a batch has about 11,400 bundles. The ids are on the query-tool allowlist
(generated, not written out) and never in the Demo cohorts; no batch seed or
clinician seed is used by a preset above. The evaluation cohort is still
`synthea-v4-seed42`.

**Not byte-for-byte reproducible.** The batches were generated on 2026-10-24 and 25,
before the Synthea recipe had a fixed end date, so Synthea ended each record
on the day it ran. The same seed run on another day gives different
bundles. Keep the archives; their manifests record the seeds, the jar sha256
and the config hash, not the end date.

**Train on `synthea-v4-seed4242`. Test on `synthea-v4-seed9001` and on the
evaluation question set** (`docs/evaluation/question-set.md`). The generator refuses
`synthea-v4-seed42` unless `--allow-eval-cohort`, which is for smoke runs
only: training on it would leak the test set. Its wearable series belongs only in
the throwaway answer-key and eval databases (`--allow-eval-cohort`,
`docs/evaluation/question-set.md`), never in a training or dev database.

Keep the training and held-out cohorts in their own database on the GPU
machine, never the dev database: the Body twin's Demo values read every
allowlisted cohort.

`bun run heart-brain` reads the same archives for a research question of its own,
streaming each one without unpacking it: whether an analysis recovers the heart and
brain relations Synthea plants. See `docs/research/heart-brain-2026-10.md`.

## Synthetic wearable series

`bun run wearables:generate -- --in .synthea/<cohort>/fhir` writes one FHIR
bundle per living subject to `.synthea/<cohort>/wearables/` (deceased
subjects are left out). The seed is the cohort's own, from `manifest.json`.
Defaults: 90 days ending 2026-10-01 (`--end`, `--days`).

| Metric             | Code                    | Unit        |
| ------------------ | ----------------------- | ----------- |
| Heart rate         | LOINC `8867-4`          | `/min`      |
| Resting heart rate | LOINC `40443-4`         | `/min`      |
| Sleep duration     | LOINC `93832-4`         | `min`       |
| Steps in 24 hours  | LOINC `41950-7`         | `{steps}/d` |
| Respiratory rate   | LOINC `9279-1`          | `/min`      |
| HRV (RMSSD)        | local `hrv-rmssd`       | `ms`        |
| Sleep score        | local `sleep-score`     | `{score}`   |
| Workout minutes    | local `workout-<sport>` | `min`       |

The LOINC and UCUM codes are the ones the open-twin Oura and Google Health
mappers use. LOINC has no code for RMSSD or a vendor sleep score, and
open-twin uses vendor-local codes for them, so these two use the local system
`urn:twinllm:synthetic-wearable`. The LOINC-only tools cannot read them;
`hrv_trend` and `sleep_summary` can (`docs/query-layer.md`, "Wearable tools"). The
default conversations do not ask about them (the sleep and trainer tracks do, see Tracks), and the no-code family no longer offers HRV,
the sleep score or training load as measures no tool can read.

Generator v2 adds workouts beside the daily series, which it leaves unchanged: on some
worn days (15–60% per subject) one workout of running, cycling, walking or strength
(mostly the subject's usual sport) with its minutes, under the local code
`workout-<sport>` at 18:00 UTC. `training_load` reads them. Their random streams are
their own (`workout-profile:` and `workouts:` keys), so no daily value moved.

### Condition effects (generator v3)

Generator v3 (the default) also reads each subject's Synthea Conditions from the same
bundle, with their onset and abatement days (`scripts/synthetic-wearables/conditions.ts`,
`conditionEffects(conditions, day, key)`). Four conditions change the series. An effect
starts on the onset day and stops on the abatement day; a stroke ignores its abatement,
because Synthea closes the acute event within days while the change in activity lasts.
Every v3 subject gets the same metrics on every worn day, whatever their conditions, so
the presence of a metric never tells a condition (see the baseline rows below). A subject
with none of the four keeps the v2 values of the seven v2 metrics. `--generator-version 2`
ignores conditions and gives the v2 series exactly (a test pins the v2 checksum); the
evaluation key was built from v2 (`docs/evaluation/question-set.md`). The manifest
records the version and, for v3, how many living subjects had each effect.

| Condition (SNOMED CT)                          | Effect                                                 | Size                                                                 | Source                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atrial fibrillation (`49436004`)               | Paroxysmal episodes after onset                        | An episode starts on about 1 day in 10 and lasts 1 to 3 days         | assumption                                                                                                                                                  |
|                                                | Share of the day in AF on an episode day (`af-burden`) | 0.2 to 0.9; 0 on other days after onset                              | assumption                                                                                                                                                  |
|                                                | Daily mean heart rate on an episode day                | +10 to +20 /min                                                      | assumption                                                                                                                                                  |
|                                                | RMSSD on an episode day                                | times (1 + 2 x burden), so up to about 2.8 times                     | direction: HRV measures assume sinus rhythm and RR irregularity inflates RMSSD (Task Force of the ESC and NASPE 1996, Circulation 93:1043); size assumption |
|                                                | Irregular-rhythm notifications per day                 | 0 below burden 0.35, 1 up to 0.7, 2 above                            | the kind of notification exists (Perez et al. 2019, NEJM 381:1909, Apple Heart Study); counts assumption                                                    |
| Chronic heart failure (`88805009`, `84114007`) | Resting heart rate                                     | +5 to +10 /min, fixed per subject                                    | assumption                                                                                                                                                  |
|                                                | RMSSD                                                  | -20 to -30%                                                          | direction: HRV is reduced in chronic heart failure and lower HRV predicts mortality (Nolan et al. 1998, Circulation 98:1510, UK-HEART); size assumption     |
|                                                | Steps                                                  | -30 to -40%                                                          | assumption                                                                                                                                                  |
| Stroke (`230690007`)                           | Steps                                                  | -60% at onset, recovering to about -20% over some 90 days, then flat | assumption                                                                                                                                                  |
|                                                | Sleep score (fragmented sleep)                         | -12 at onset, easing to -5                                           | assumption                                                                                                                                                  |
| Sleep apnea (`78275009`, `73430006`)           | Nightly SpO2 mean (LOINC `59408-5`)                    | 92.5 to 95%                                                          | assumption                                                                                                                                                  |
|                                                | Nightly SpO2 minimum (local `spo2-min`)                | 80 to 88%                                                            | assumption                                                                                                                                                  |
|                                                | Respiratory rate                                       | +0.5 to +1.0 /min, fixed per subject                                 | assumption                                                                                                                                                  |
| Everyone (baseline)                            | Nightly SpO2 mean                                      | 95 to 98%                                                            | assumption                                                                                                                                                  |
|                                                | Nightly SpO2 minimum                                   | 89 to 94%                                                            | assumption                                                                                                                                                  |
|                                                | False irregular-rhythm notifications outside AF        | about 1 per person-year                                              | false positives exist (Perez et al. 2019, NEJM 381:1909; Lubitz et al. 2022, Circulation, Fitbit Heart Study); rate assumption                              |
|                                                | AF burden without AF                                   | 0                                                                    | by definition                                                                                                                                               |
| Hypertension (`59621000` and others)           | None                                                   |                                                                      | a wrist device does not measure blood pressure, so the series cannot show it                                                                                |

Several conditions add up: deltas are summed and factors multiplied. The sleep score is
set before the AF inflation of RMSSD, so an episode never reads as better recovery.

New metrics in v3, for every subject on every worn day (none in v2):

| Metric                         | Code                                             | Unit      |
| ------------------------------ | ------------------------------------------------ | --------- |
| Nightly SpO2 mean              | LOINC `59408-5`                                  | `%`       |
| Nightly SpO2 minimum           | local `spo2-min`                                 | `%`       |
| Irregular-rhythm notifications | local `irregular-rhythm-notification`            | `{count}` |
| AF burden (ground truth)       | `urn:twinllm:synthetic-ground-truth` `af-burden` | `1`       |

`59408-5` is the SpO2 code the Oura, Whoop and Apple Health readers use;
`irregular-rhythm-notification` is the Google Health connector's name for the same kind
of notification. The AF burden is something no device reports: it is the simulator's
ground truth, in its own code system and tagged `simulator-ground-truth`, so it can be
used to check an answer and is never a reading.

Limits, stated plainly: every size above is an assumption for research data, not a
fitted model of a disease. Persistent AF is not modelled (every AF subject has
paroxysmal episodes). The SpO2 and notification values of a healthy subject are drawn
from the ranges above, not from any device.

On the pinned evaluation cohort `synthea-v4-seed42` (release `eval-cohort-v1`, 37
patient files, 30 living), every onset is before the window (records end 2026-01-01),
so the effects run through the whole window. Of the 30 living subjects, 1 has the AF
effect and none heart failure, stroke or sleep apnea; the 3 subjects with heart
failure died in Synthea and get no series. The evaluation key still uses v2.

Each subject gets fixed baselines, a share of worn days (one in twelve wears
the device on about 15% of days), a slow resting heart rate drift and, for
some, a few days with raised resting heart rate near the end. Every resource
carries the HL7 test-data tag `HTEST` and a generator tag. The bundles reuse
the subject's Synthea Patient id and identifier (nothing else), so
`warehouse:ingest` stores them on the same `subject_ref`:

```sh
bun run warehouse:ingest .synthea/synthea-v4-seed4242/wearables --cohort synthea-v4-seed4242
```

## Conversations

`bun run training:conversations -- --cohort <id> [--out <file>] [--seed <n>]
[--anchor <day>] [--max-subjects <n>] [--families a,b] [--inline-tools]` reads
`.env.training`, a copy of `.env.synthetic.example` with `DATABASE_URL` at
the training database. Tool calls are audited as `training-conversations`.
It prints counts only. For `--out training-data/out/<cohort>.jsonl` (the
default, gitignored) it writes:

| File                     | What                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `<cohort>.jsonl`         | One record per line: `messages` only                            |
| `<cohort>.meta.jsonl`    | One `meta` record per line, same order                          |
| `<cohort>.manifest.json` | Counts, seed, prompt id, and the `tools` list once              |
| `<cohort>.stats.json`    | Counts per family, template, style and outcome; shares; lengths |

Both JSONL files are written as `.partial` and renamed only when the run
finishes; a failed run keeps neither. `--inline-tools` also puts `tools` on
every record, for trainers that want the OpenAI fine-tuning form.

`messages` are system, user, one assistant turn per tool call with its tool
result, then the final answer. `tools` are the twelve tools a chat request
sends (`createChatTools`): the nine query tools in the slim form
(`openaiToolList`, `docs/query-layer.md`, "Manifests") plus `gbd_population`,
`guideline_search` and `knowledge_search`, with the schemas the AI SDK sends.
The system prompt is the real Twin prompt in synthetic mode with every tool
offered and no wearable linked (`twin-system-prompt/synthetic/no-wearables`).
`meta` holds the family, outcome, `subject_ref`, cohort id, seed, generator
version (2), tool names, sha256 of the tool arguments, system prompt id and
sha256, the expected `answer_class`, the template id and group, style, whether
a typo was added, and the one LOINC the question is about (`measure_loinc`,
null for coverage and questions with no code). The same cohort, database and
seed give the same files byte for byte.

### Questions

Each family asks from a slot of templates (`questions.ts`) in four styles:
formal, casual, terse and non-native English; about 10% get one keyboard typo.
A template id is `slot.style.n` and its group `slot.style`. Measures are named
by label or alias, sometimes with the unit; dates are written four ways
(`3 Aug 2026`, `2026-08-03`, `3 August 2026`, `August 3, 2026`); some wearable
questions say "the last N days" and read `subject_window` first. The app is
English only, so there are no German or French questions.

| Family               | Share | Tools                                                                  |
| -------------------- | ----- | ---------------------------------------------------------------------- |
| `latest_value`       | all   | `latest_by_loinc`                                                      |
| `trend`              | all   | (`subject_window`), `trend`                                            |
| `baseline_deviation` | all   | (`subject_window`), `baseline_deviation`                               |
| `coverage`           | all   | (`subject_window`), `coverage`                                         |
| `compare_windows`    | all   | (`subject_window`), `compare_windows`                                  |
| `absent_code`        | 50%   | `latest_by_loinc` with the asked code (15 absent labs)                 |
| `no_code`            | 40%   | none: a measure no tool can read (VO2max, HRV, …)                      |
| `wearable_key`       | 25%   | none: a vendor key not in Available keys                               |
| `outside_record`     | 40%   | `subject_window`; the period is before or after the record             |
| `odd_ref`            | 30%   | `latest_by_loinc` with the ref as typed, or none (no ref)              |
| `near_miss`          | 50%   | `latest_by_loinc` with the asked code, neighbour named                 |
| `unit_mismatch`      | all\* | (`subject_window`), `trend`, `baseline_deviation` or `compare_windows` |
| `unit_conversion`    | 60%   | `latest_by_loinc`, then `convert_unit` when its table holds the pair   |
| `out_of_cohort`      | 10%   | `latest_by_loinc` on an unknown ref                                    |
| `decline_dose`       | 25%   | none, `REFUSE:`                                                        |
| `decline_condition`  | 25%   | none, `REFUSE:`                                                        |
| `other_person`       | 15%   | none                                                                   |

\* only for subjects whose records hold a mixed-unit code (below).

### Genome families (`--genome`)

Off by default. With `--genome` the run adds seven families after all the others, so
every other conversation stays byte-for-byte the same. Genome records get the system
prompt and tools of a personal turn that carries the genome tools
(`twin-system-prompt/personal/genome`: `createChatTools` with the genome ports, so
`genome_report` and `dna_ask` have #107's definitions, the same as
`packages/carbon-x/__snapshots__/genome-tools.json`); every other record keeps the
synthetic prompt and tools. The manifest gets `genome` (catalog version, prompt id,
tools) and the stats `genome_share`. Naming a genome family in `--families` without
`--genome` is refused.

The report is the subject's synthetic one (`docs/genome-synthetic.md`), and tool
results have the shapes the real tools return: `genome_report` gives the parsed rows
with gene, star allele and gene note; `dna_ask` gives the site, the genotype and an
answer. The real Carbon-X output is not available here, so that answer is a fixed text
from the catalog row (gene, consequence, ClinVar significance), and its `source` says
it is a synthetic stand-in. A no-call site or a site outside the report gets no
`dna_ask` call, as the real tool refuses both. Questions are first person ("my
report") in the same four styles and with the same typo rule, from their own template
bank (`genome-questions.ts`). Answers quote the labelled answer, say it is research
information only, and never give a dose, a medicine change or a clinical reading.

| Family                   | Share   | Tools                            | Outcome                    |
| ------------------------ | ------- | -------------------------------- | -------------------------- |
| `genome_variant`         | 50%     | `genome_report`, `dna_ask`       | `answered`                 |
| `genome_variants`        | 25%     | `genome_report`, `dna_ask` twice | `answered`                 |
| `genome_no_call`         | all\*\* | `genome_report`                  | `no_call`                  |
| `genome_not_in_report`   | 30%     | `genome_report`                  | `not_in_report`            |
| `genome_decline_dose`    | 25%     | none, `REFUSE:`                  | `declined`                 |
| `genome_other_person`    | 15%     | none                             | `out_of_scope_person`      |
| `genome_hosted_provider` | 15%     | none                             | `declined_hosted_provider` |

\*\* only for subjects with a no-call on the panel (about one in five).

No answer ever reads a code other than the one asked about;
`families.test.ts` checks that over many seeds. The no-data answers say
plainly that there is no code or no data and that no other measure was used in
its place.

**Overlap with the evaluation.** The no-data, near-miss and unit families
include the evaluation set's S6 probe measures (skin temperature,
eGFR, TSH, SpO2, RDW, Oura readiness, Whoop recovery, LOINC 99999-9) like any
other measure. S6 scores after pilot 2 therefore measure in-distribution
behaviour, not generalisation; a clean generalisation number needs a fresh
held-out probe set. The question templates still never repeat an evaluation
question.

Wearable measures use windows ending on the series' last day; clinical
measures (weight, HbA1c, systolic pressure, cholesterol, BMI) use the
subject's record window from `subject_window`. Each family draws from its
own seeded stream, so `--families` never changes the other families'
conversations.

- **Wearable codes are shared.** Daily heart rate (`8867-4`) and respiratory
  rate (`9279-1`) use the same LOINC codes as Synthea's clinic vitals, so a
  wearable-window answer can include a clinic reading from those days. All
  times are UTC.
- **Subjects without a series.** Before a subject's conversations the
  generator reads `subject_window` once (audited, not part of any
  conversation). If the records end before the wearable window (deceased
  subjects get no series), that subject gets clinical questions only.
- **Mixed units.** `unit_mismatch` uses codes Synthea v4 writes in two units:
  urine specific gravity (`5811-5`), urine pH (`5803-2`) and high-sensitivity
  troponin I (`89579-7`). A planning read (`subject_window`, then one
  `coverage` over those codes for six years; audited, not part of the
  conversation) finds a mixed code; the conversation then asks a trend,
  baseline or comparison and reports what the tool returns, usually
  `MIXED_UNITS`.
- **Conversions.** `unit_conversion` never converts in the text. A pair in
  `convert_unit`'s table (% → mmol/mol for HbA1c; mg/dL → mmol/L for
  glucose, total, LDL and HDL cholesterol and triglycerides; creatinine
  mg/dL → µmol/L) is converted by that tool, only from the unit it was
  written for, and Reasoning names the tool's formula and rounding. Any other
  pair (kg → lb, min → hours, cm → inches, mmHg → kPa, /min → per hour) is
  answered in the stored unit with the outcome `not_converted`. A reading in
  another unit is reported as stored. Until #120 the answers converted these
  pairs with a fixed factor themselves; only this family changed, but every
  record's tool list and system prompt now carry `convert_unit`.

### Tracks (`--track`)

One training set per agent (#210), so a fine-tune can learn one agent's role.
`--track <id>` keeps that agent's families, codes and question styles, adds the
hand-over family, and puts the agent's line (`Agent: <name>. <role>`) right under
the prompt's first line, where an agent turn in the chat has it. The prompt id
gets `/agent/<agent id>`, the manifest gets `track` (id, agent, role, families,
codes, styles), and the default file is `<cohort>.<track>.jsonl`. Without
`--track` nothing changes: `tracks.test.ts` checks a run against hashes of every
file taken before tracks existed.

The tracks are in `scripts/training-data/tracks.ts`. Each agent's id, name and
role line are read from `infrastructure/agents.ts` (#218), the agents the chat
runs, so a role change there reaches the training data without a second copy.
Only each agent's area and hand-over topics live in `tracks.ts`.

| Track      | Agent              | Families                                                                                                                                                                                                      | Codes                                                                      | Styles         |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------- |
| `general`  | General            | every default family                                                                                                                                                                                          | every measure                                                              | all four       |
| `diet`     | Diet specialist    | latest, trend, baseline, compare, outside record, near miss, unit conversion, declines, other person                                                                                                          | weight, BMI, HbA1c, glucose, total, LDL and HDL cholesterol, triglycerides | all four       |
| `anatomy`  | Anatomy specialist | `anatomy_note`, latest, near miss, absent code, decline condition, other person                                                                                                                               | systolic blood pressure, creatinine                                        | all four       |
| `sleep`    | Sleep              | `sleep_summary`, `sleep_no_rows`, the five data families, outside record, wearable key, decline condition, other person                                                                                       | sleep duration, respiratory rate                                           | formal, casual |
| `trainer`  | Trainer            | `hrv_trend`, `resting_hr_trend`, `training_load`, `wearable_too_short`, `wearable_no_rows`, the five data families, outside record, near miss, unit conversion, wearable key, decline condition, other person | resting heart rate, heart rate, daily step count                           | casual, terse  |
| `genetics` | Genetics           | the seven genome families (turns on `--genome`)                                                                                                                                                               | none                                                                       | all four       |

Every track also has `agent_handover`. No two specialists ask about the same
code. A track keeps only questions in its styles, so the sleep and trainer sets
are smaller per subject. A subject without a wearable series gets no sleep or
trainer data questions, and no wearable tool question except the NO_ROWS ones.

**Wearable families** (sleep and trainer tracks, `wearable-families.ts`). They
call the wearable tools on the subject's synthetic series
(`scripts/synthetic-wearables`, source `all`), through the same audited tools a
chat uses, so every number is one `packages/query-tools/wearable-analytics.ts`
computed. Templates name what the tool returned and nothing else.

| Family               | Share | Tool                                               | Window                     | Outcome             |
| -------------------- | ----- | -------------------------------------------------- | -------------------------- | ------------------- |
| `sleep_summary`      | all   | `sleep_summary`                                    | last 7, 14, 28 or 30 days  | `answered`          |
| `sleep_no_rows`      | 30%   | `sleep_summary`                                    | a month in the year before | `no_rows` (NO_ROWS) |
| `hrv_trend`          | all   | `hrv_trend`                                        | last 28, 42, 60 or 90 days | `answered`          |
| `resting_hr_trend`   | all   | `resting_hr_trend`                                 | last 28, 42, 60 or 90 days | `answered`          |
| `training_load`      | all   | `training_load` (per day or week)                  | last 28, 42 or 56 days     | `answered`          |
| `wearable_too_short` | 30%   | `hrv_trend` or `resting_hr_trend`                  | last 3 to 5 days           | `WINDOW_TOO_SHORT`  |
| `wearable_no_rows`   | 30%   | `hrv_trend`, `resting_hr_trend` or `training_load` | a month in the year before | `no_rows` (NO_ROWS) |

A sparse wearer (one subject in twelve) gets the refusal the tool gives,
usually WINDOW_TOO_SHORT or NO_ROWS, in any of them.

**`anatomy_note`** (anatomy track, `anatomy-families.ts`): which body system and
region a biomarker belongs to, for one of the 67 markers of the Anchor
catalogue, or (one in five) a code the catalogue does not list. It calls
`knowledge_search` and the answer quotes the catalogue line it found, with its
file and section; nothing found is said plainly. The real tool embeds the
query and reads the nearest chunks from the database. Training runs without an
embedding model, so `knowledge-notes.ts` stands in for it: it cuts
`knowledge/opentwin/biomarker-catalogue.md` with the ingest's own chunker and
returns the chunks that name the LOINC code in the query, in the real tool's
shape. A model trained on it learns to cite the passage, not the ranking.

**`agent_handover`** (half of subjects, tracks only): a question that belongs
to another agent. Templates only, like every other family.

- A specialist asked about another agent's area (the hand-over bank in
  `handover-family.ts`, `handover.<style>`) calls no tool, says the question is
  outside what it looks at and names the agent that fits with that agent's
  role line. Outcome `handed_over`.
- The General agent asked a Diet, Sleep or Trainer question reads the
  latest value with `latest_by_loinc`, answers as `latest_value` does, and
  names the specialist to ask for more. Asked an anatomy question, it answers
  as `anatomy_note` does and names the Anatomy agent. Asked about the genome
  report, which a General turn cannot read, it calls no tool and names the
  Genetics agent.

On the 1M cohort, `training:batches -- --tracks` writes one set per track in
the conversations step, after the default set, while the batch's rows are
still in the database:

```sh
bun run training:batches -- --batches 1001-1099 --skip-rejected \
  --tracks general,diet,anatomy,sleep,trainer,genetics
bun run training:batches -- --batches 1100 --skip-rejected \
  --tracks general,diet,anatomy,sleep,trainer,genetics
```

A batch is done when its default manifest and every track's manifest exist. A
batch finished before `--tracks` is unpacked and ingested again, and only the
missing track sets are written. The genetics track builds each subject's
synthetic genome report from the variant catalog in the process, as `--genome`
does, so it needs no genome rows in the database.

One cohort without batches works the same way:

```sh
bun run training:conversations -- --cohort synthea-v4-seed4242 --track diet
bun run training:conversations -- --cohort synthea-v4-seed4242 --track genetics
```

### Split

`bun run training:split -- --in <out>.jsonl [--seed n] [--template-share 0.1]
[--code-share 0.1] [--subject-share 0.02]` writes `<out>.train.jsonl`,
`<out>.val.jsonl` (each with a `.meta.jsonl`) and `<out>.split.json`.
Validation gets every conversation in a held-out template group, about a
held-out LOINC code, or about a held-out subject, so it measures wording and
codes the model never saw. Nothing is held out that would leave a family or a
question slot without training data. The manifest lists the held-out groups
and codes, counts per reason and stats for each part. It reads files only.

### Looking at the files

The Data page's Training data tab (`/customize/data/cohort/training`, any `DATA_MODE`) lists the sets in `training-data/out/`, with counts per family and outcome from the meta file, and opens one conversation with its question, tool calls, tool results and answer. It reads the files only; nothing is audited because nothing is read from the warehouse.

On a fresh machine `bun run setup:local` writes one small set there, so the tab is not empty: `bun run training:sample` runs this generator on the first 12 subjects of the evaluation cohort (`--cohort synthea-v4-seed42 --allow-eval-cohort --max-subjects 12 --out training-data/out/sample-synthea-v4-seed42.jsonl`) against the database in `.env.local`, with `DATA_MODE=synthetic`. That is the smoke run described above: the same families, templates and audited tools, all numbers from the closed tools on synthetic rows. The evaluation cohort has no wearable series, so its conversations are clinical only. It is a set to look at, never to train on, and the tab marks it as such. `--skip-training-sample` leaves it out. Last run 2026-10-27, Linux, a throwaway database holding release `eval-cohort-v1`: 128 conversations from 12 subjects (57 answered, 15 no rows, 12 no code, 9 declined, 8 outside the record, 7 MIXED_UNITS and fewer of the rest), in about a second.

### No evaluation question is reused

The evaluation's probes use TSH, SpO2, eGFR and RDW, so the training set uses
other codes for the same cases. No question template equals an evaluation
question after refs, dates and whitespace are normalised;
`scripts/training-data/families.test.ts` checks every template against
`evaluation/questions.v1.json` with every measure label.

## Sizes

From the smoke run (12 patients, 13 bundles): about 5.8 conversations per
subject and about 4 KB per record plus a small meta line. `--inline-tools`
adds about 7 KB per record.

Batch 1001 of the 1M cohort, measured on 2026-10-25 (one machine, 8 cores,
32 GB RAM, Postgres 18 on the same SSD; see "The 1M cohort, one batch at a
time" below for the times):

| What                    | Batch 1001                                                     |
| ----------------------- | -------------------------------------------------------------- |
| FHIR bundles            | 11,416 (10,000 living), 41.0 GB, about 3.6 MB each             |
| Wearable series         | 10,000 subjects, 5,280,681 readings, 4.4 GB                    |
| Warehouse rows          | 10,168,794 numeric (5,262,544 wearable), 1,243,744 non-numeric |
| Database at its largest | 7.5 GB                                                         |
| Conversations           | 68,906 from 11,380 subjects (6.1 per subject)                  |
| JSONL / meta            | 254.0 MB / 35.5 MB (about 3.7 KB per record)                   |
| Audit rows left behind  | 105,075 (about 46 MB)                                          |
| Peak disk (logical)     | 53 GB: 45.4 GB unpacked, 7.5 GB database                       |

The FHIR and database figures are file sizes. On a file system that
compresses (btrfs with zstd here), the peak took about 10.5 GB of physical
disk. The `training` and `held-out` presets have not been run; scaled from
the 12-patient smoke run (about 4.6 MB of FHIR per patient, ages 40–75) they
come to about 46 GB and 4.6 GB of FHIR, about 58,000 and 5,800 conversations.

## On the GPU machine

```sh
bun run synthea:generate -- --preset training      # Java 21+
bun run wearables:generate -- --in .synthea/synthea-v4-seed4242/fhir
# a fresh Postgres with pgvector for this cohort only, then:
cp .env.synthetic.example .env.training           # set DATABASE_URL to it
DATABASE_URL="$(grep '^DATABASE_URL=' .env.training | cut -d= -f2-)" bunx prisma migrate deploy
for dir in fhir wearables; do
  bun --env-file=.env.training --preload ./features/chat/response/preload-server-only.mjs \
    scripts/warehouse/ingest.ts .synthea/synthea-v4-seed4242/$dir --cohort synthea-v4-seed4242
done
bun run training:conversations -- --cohort synthea-v4-seed4242
```

Repeat with `--preset held-out` and `synthea-v4-seed9001` in a second
database for the test file. Drop the databases when the files are written.
For the 1M cohort, `training:batches` does all of this per batch (below).

## The 1M cohort, one batch at a time

```sh
cp .env.synthetic.example .env.training   # DATABASE_URL at a database for training cohorts only
DATABASE_URL="$(grep '^DATABASE_URL=' .env.training | cut -d= -f2-)" bunx prisma migrate deploy
bun run training:batches -- --batches 1001-1010 --skip-rejected
bun run training:batches -- --batches 1100 --archives <dir> --work <dir> --out training-data/out --keep
```

`--batches` takes seeds: `1001-1010`, `1100` or `1001,1005-1007`. Defaults:
`--archives ../synthea-1m/batches` (the `batch-NNN.tar.zst` and
`batch-NNN.manifest.json` files), `--work .synthea/batches`, `--out
training-data/out`. Per batch, in order, one line per step with its time:

1. **unpack**: the archive to `<work>/<cohort>/fhir`, and the batch manifest
   next to it as `manifest.json` with the cohort id added (the seed, clinician
   seed and N must match the batch).
2. **wearables**: `wearables:generate` for that fhir dir (the seed comes from
   the manifest).
3. **ingest fhir**: `warehouse:ingest --cohort synthea-v4-seed<seed>`, split
   across `--workers` ingest processes (default: CPU cores − 1; passed on to
   both ingest steps). A rejected bundle stops the run unless
   `--skip-rejected` (below).
4. **ingest wearables**: the same for the wearable series, leaving out the
   series of any subject whose FHIR bundle was rejected. A rejected wearable
   bundle always stops the run.
5. **conversations**: `training:conversations --cohort <id> --out
<out>/<id>.jsonl`, with `--rejected <out>/<id>.rejected.json` when there
   is one.
6. **clear rows**: delete the cohort's observations, non-numeric rows, bundles
   and subjects. Audit rows stay: the chain is append-only, and a deleted row
   would break `verifyChain`. They hold no values (hashes and row counts), and
   name the subject_refs of a cohort that is gone.
7. **remove files**: delete `<work>/<cohort>` (not with `--keep`).

Each step runs the existing CLI with `.env.training` and writes its output to
`<work>/logs/<cohort>.<step>.log`. A batch whose conversation manifest exists
is skipped (only its leftover rows and files are cleared). A fully unpacked
copy, kept by `--keep` or left by a run that stopped, is reused. Every archive must be there before the first
batch starts.

It refuses to run unless `DATA_MODE=synthetic`, the database name differs from
the one in `.env.local` and `.env.synthetic.example`, and the database holds
no Demo cohort. Unpack one batch at a time: each needs about 53 GB free (see
Sizes).

### Rejected bundles and `--skip-rejected`

All ages bring in Synthea's adolescent scoliosis screening
(`AIS_From_School_Screening_to_SOSORT_Recommendations`). It writes three
SNOMED-coded observations (body posture, Cobb angle, Risser sign) whose
`valueQuantity` has a UCUM system but no unit or code. The open-twin
normaliser refuses those bundles (`ot-unit-policy`, `ot-quantity-no-code`),
and the warehouse writes nothing for them. Batch 1001 has 36 of 11,416,
batch 1100 has 43 of 11,439: about 0.3%. The 40–75 presets never had them.

By default a rejected bundle stops the batch. With `--skip-rejected` the
batch goes on without those people:

- the ingest line ends `skipped N of M bundles (reasons…)`;
- `<out>/<cohort>.rejected.json` lists each rejected bundle's file,
  subject_ref and reason codes, with the counts per reason;
- their wearable series are not ingested, so no subject has wearable rows
  only;
- the conversation manifest gets `rejected_bundles` (`count`, `of`,
  `reasons`, `file`).

More than 1% of a batch's bundles rejected stops the batch even with the
flag, so a new kind of failure cannot quietly drop many people. Raise the
limit only after reading the log: `--max-rejected-share 0.02`.

### Batch 1001

`bun run training:batches -- --batches 1001 --skip-rejected`, 2026-10-25,
against a fresh database (8 cores, 32 GB RAM):

| Step             | Time    | Result                                                                                    |
| ---------------- | ------- | ----------------------------------------------------------------------------------------- |
| unpack           | 30 s    | 11,416 files, 41.0 GB                                                                     |
| wearables        | 1m 50s  | 10,000 subjects, 5,280,681 readings                                                       |
| ingest fhir      | 33m 52s | 11,380 bundles inserted; skipped 36 of 11,416 (22 ot-unit-policy, 14 ot-quantity-no-code) |
| ingest wearables | 16m 52s | 9,966 bundles inserted, 34 series of skipped subjects left out                            |
| conversations    | 20m 56s | 68,906 conversations from 11,380 subjects, 254.0 MB JSONL                                 |
| clear rows       | 8m 43s  | 11,380 subjects, 10,168,794 numeric, 1,243,744 non-numeric, 21,346 bundles                |
| remove files     | 3 s     | 45.4 GB freed                                                                             |

About 83 minutes in all (the unpack time is from an earlier run of the same
batch; this run reused that copy). A second run prints `conversations already
written, skipped`. The JSONL was byte-identical to an earlier run of the same
steps. A run of all 100 batches would take about 6 days on this machine, and
leave about 29 GB of JSONL and meta files and about 10 million audit rows.

Batch 1100 (held-out), the same way: 36s, 1m 52s, 36m 17s (11,396
inserted; skipped 43 of 11,439: 28 ot-unit-policy, 15 ot-quantity-no-code),
16m 43s (42 series left out), 20m 54s (69,065 conversations from 11,396
subjects, 254.6 MB JSONL), 9m 22s, 3 s: 1h 25m 49s in all. The audit table
held 210,442 rows (91 MB) after the two batches.

Ingest was two thirds of the time: one bundle at a time in one process, at
about one CPU core, while Postgres stayed nearly idle, and every file parsed
twice. Since #5 the fhir dir is split across `--workers` processes and each
file is parsed once. The second largest cost, clearing rows, would be a
`TRUNCATE` when the database only ever holds the one batch.

### Parallel ingest (#5)

`warehouse:ingest` of batch 1001's FHIR folder alone (11,416 files) into a
throwaway database, 2026-10-27, on the same 8-core machine while other jobs
kept it busy (7 Synthea processes, an Ollama model; load average 15–20 during
the first run, 8–13 during the second), so the two runs did not get the same
CPU:

| Run                       | Wall time  | CPU time of the ingest processes |
| ------------------------- | ---------- | -------------------------------- |
| one process (before)      | 1h 44m 26s | 48m 47s                          |
| `--workers 4`             | 12m 51s    | 42m 03s                          |
| `--workers 4`, second run | 1m 13s     | 4m 14s (all 11,380 already in)   |

Both runs inserted 11,380 bundles and rejected the same 36 files (22
`ot-unit-policy`, 14 `ot-quantity-no-code`). The six warehouse tables
(subjects, bundles, 4,906,250 observations, 1,243,744 non-numeric, 395,207
conditions, 525,749 medication requests) had the same row counts and the same
order-independent hash of their contents. The single process got about half a
core on average on the busy machine and the four processes about 3.3 cores, so
most of the gain is parallelism; skipping the second parse saved about 14% of
the CPU time. On an idle machine expect roughly the CPU time divided by the
number of workers. The run used 4 workers, not the default 7, to leave room
for the other jobs.

## Human check

Before any training run, a person reads a random sample (at least 50
conversations, every family present) and checks: the numbers match the tool
result in the same conversation, units and dates are present, refusals are
plain, nothing reads as a statement about a real person. Record who checked,
the sample size and the file sha256 with the training run.

## Training code

The training run itself is Python and lives in `python/` (`python/README.md`):
a uv project with a `train` dependency group (torch, transformers, peft, trl,
datasets) and an `analysis` group for reading harness output. It reads the
JSONL files above and the gitignored `evaluation/runs/`; the app never
imports it, and skills and MCP servers stay TypeScript.

**Context length.** Chat and `bun run eval` both reach a local model through
the same resolver, so an evaluated answer runs with the context the app asks
Ollama for: `OLLAMA_NUM_CTX`, default 16384 (see
[providers.md](providers.md#ollama-context)). Train pilot 2 with a maximum
sequence length of at least that, so a training record is never cut where the
served model would see the whole prompt. A Modelfile's own `num_ctx` (8192 in
the pilot 1 models) is overridden by the request.

## Licences

- **Synthea** is Apache-2.0 (v4.0.0, pinned in `scripts/synthea/generate-local.sh`).
  Its output is synthetic and ours to use.
- **Base models**: the licence of each candidate is in `docs/models.md`.
  Qwen 3 and the Apertus and Meditron models are Apache-2.0; Apertus v1.5
  adds the Swiss AI Acceptable Use Policy.
- **MedGemma** (HAI-DEF terms): a model fine-tuned from it is a model
  derivative under those terms. The section 3.2 use restrictions carry over to
  it and to anyone we share it with, together with a copy of the terms and
  notice that the files were modified. Plain reading, not legal advice; read
  `docs/models.md` and the terms before fine-tuning it.

## Limits

- The answers are templates; only the questions vary.
- Every chat tool is offered, but no conversation calls the
  guideline, GBD or knowledge tools.
- Token counts in the stats are characters / 4, a rough estimate.
- With `--skip-rejected`, the 1M batches leave out the people with
  scoliosis-screening observations (about 0.3%), so the training data has
  none of them. The batches are not byte-for-byte
  reproducible (see "The 1M cohort").
- `list_subjects` caps at 200 rows, so the generator reads the subject list
  directly from the cohort's subjects (refs only); every number still comes
  through the audited tools.
