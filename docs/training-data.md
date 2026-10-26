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

| Preset     | Cohort id             | N      | Seed | Ages  | Role                                    |
| ---------- | --------------------- | ------ | ---- | ----- | --------------------------------------- |
| `training` | `synthea-v4-seed4242` | 10,000 | 4242 | 40–75 | Training conversations                  |
| `held-out` | `synthea-v4-seed9001` | 1,000  | 9001 | 40–75 | Test conversations                      |
| `eval`     | `synthea-v4-seed42`   | 30     | 42   | 40–75 | The 81-question evaluation, never train |

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
81-question set** (`docs/evaluation/question-set.md`). The generator refuses
`synthea-v4-seed42` unless `--allow-eval-cohort`, which is for smoke runs
only: training on it would leak the test set. Do not add wearable series to
`synthea-v4-seed42` either; extra heart rate rows would change the answer
key.

Keep the training and held-out cohorts in their own database on the GPU
machine, never the dev database: the Body twin's Demo values read every
allowlisted cohort.

## Synthetic wearable series

`bun run wearables:generate -- --in .synthea/<cohort>/fhir` writes one FHIR
bundle per living subject to `.synthea/<cohort>/wearables/` (deceased
subjects are left out). The seed is the cohort's own, from `manifest.json`.
Defaults: 90 days ending 2026-10-01 (`--end`, `--days`).

| Metric             | Code                | Unit        |
| ------------------ | ------------------- | ----------- |
| Heart rate         | LOINC `8867-4`      | `/min`      |
| Resting heart rate | LOINC `40443-4`     | `/min`      |
| Sleep duration     | LOINC `93832-4`     | `min`       |
| Steps in 24 hours  | LOINC `41950-7`     | `{steps}/d` |
| Respiratory rate   | LOINC `9279-1`      | `/min`      |
| HRV (RMSSD)        | local `hrv-rmssd`   | `ms`        |
| Sleep score        | local `sleep-score` | `{score}`   |

The LOINC and UCUM codes are the ones the open-twin Oura and Google Health
mappers use. LOINC has no code for RMSSD or a vendor sleep score, and
open-twin uses vendor-local codes for them, so these two use the local system
`urn:twinllm:synthetic-wearable`. They are stored but no query tool can read
them (the tools take LOINC only), so the conversations do not ask about them.

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
| `unit_conversion`    | 60%   | `latest_by_loinc`, converted with a fixed factor                       |
| `out_of_cohort`      | 10%   | `latest_by_loinc` on an unknown ref                                    |
| `decline_dose`       | 25%   | none, `REFUSE:`                                                        |
| `decline_condition`  | 25%   | none, `REFUSE:`                                                        |
| `other_person`       | 15%   | none                                                                   |

\* only for subjects whose records hold a mixed-unit code (below).

No answer ever reads a code other than the one asked about;
`families.test.ts` checks that over many seeds. The no-data answers say
plainly that there is no code or no data and that no other measure was used in
its place.

**Overlap with the evaluation.** The no-data, near-miss and unit families
include the 81-question evaluation's S6 probe measures (skin temperature,
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
- **Conversions.** `unit_conversion` converts a latest value only from the
  unit it was written for (kg → lb, % → mmol/mol, mg/dL → mmol/L, min →
  hours, cm → inches, mmHg → kPa, /min → per hour) and names the factor in
  Reasoning. A reading in another unit is reported as stored.

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

The Data page's Training data tab (`/data/training`, any `DATA_MODE`) lists the sets in `training-data/out/`, with counts per family and outcome from the meta file, and opens one conversation with its question, tool calls, tool results and answer. It reads the files only; nothing is audited because nothing is read from the warehouse.

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
3. **ingest fhir**: `warehouse:ingest --cohort synthea-v4-seed<seed>`. A
   rejected bundle stops the run unless `--skip-rejected` (below).
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

Ingest is two thirds of the time. It runs one bundle at a time in one
process, at about one CPU core, while Postgres stays nearly idle, and it
parses every file twice (the Synthea check reads them all before the first
write). Splitting the fhir dir across several ingest processes would cut it
most. The second largest cost, clearing rows, would be a `TRUNCATE` when the
database only ever holds the one batch.

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
- All twelve chat tools are offered, but no conversation calls the
  guideline, GBD or knowledge tools.
- Token counts in the stats are characters / 4, a rough estimate.
- With `--skip-rejected`, the 1M batches leave out the people with
  scoliosis-screening observations (about 0.3%), so the training data has
  none of them. The batches are not byte-for-byte
  reproducible (see "The 1M cohort").
- `list_subjects` caps at 200 rows, so the generator reads the subject list
  directly from the cohort's subjects (refs only); every number still comes
  through the audited tools.
