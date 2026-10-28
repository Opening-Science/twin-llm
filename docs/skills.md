# Skills

A skill is data plus tests: a folder under `skills/` with a `SKILL.md` and an `evals/`
folder of cases. It says what a command may read and use; the code decides what actually
runs. Plan: [chat-platform.md](chat-platform.md), section 2. Issue #41.

The `/` palette lists them and the chat runs them (#42); see "Running a skill" below.
Two built-in commands come first in the palette; see "Built-in commands" at the end.

## SKILL.md

```markdown
---
name: sleep
description: Describe a subject's sleep duration against their own recent baseline.
tools: [coverage, summary_stats, trend, baseline_deviation, knowledge_search]
sources: [cohort-records, cohort-analytics, opentwin-knowledge, wearable-context]
providers: [ollama]
views: [chart.timeseries, chart.compare]
---

Instructions for the model.
```

| Field         | Required | Meaning                                                                                                 |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `name`        | yes      | Lower-case letters, digits and dashes; equals the folder name.                                          |
| `description` | yes      | One line, at most 200 characters.                                                                       |
| `tools`       | yes      | Chat tools the skill may call. Each must belong to a listed source.                                     |
| `sources`     | yes      | Knowledge sources from `infrastructure/knowledge-sources.ts`, plus `wearable-context`.                  |
| `providers`   | no       | Model providers the skill may run on. Defaults to `[ollama]`, local only.                               |
| `views`       | no       | View kinds it may ask for: `chart.timeseries`, `chart.compare`, `biomarker.card`, `twin.body`, `table`. |

Unknown keys are errors. Lists are `[a, b]` or indented `- item` lines. The body after
the frontmatter is the skill's instructions and may not be empty.

Providers never widen the data-mode policy (`infrastructure/data-mode-policy.ts`). A
skill that reads `wearable-context` cannot list a provider the policy never lets see
personal data (OpenRouter, remote GPU, Infomaniak). A provider the skill does list still
goes through the policy on every request, so Exoscale only takes personal data with
`EXOSCALE_PERSONAL_DATA=consented-pilot`.

A skill that calls a genome tool (`genome_report`, `dna_ask`) may list only `ollama`:
the genome policy never lets a genotype reach a hosted model, the consented pilot
included ([genome.md](genome.md)).

## Eval cases

One JSON file per case in `evals/`, named `lower-case-with-dashes.json`:

```json
{
  "question": "Was last week's sleep shorter than my usual?",
  "provider": "ollama",
  "dataMode": "personal",
  "wearableContext": true,
  "script": [
    {
      "tool": "baseline_deviation",
      "input": {
        "subject_ref": "…",
        "loinc": "93832-4",
        "baseline": { "start": "2025-09-24", "end": "2025-10-23" },
        "target": { "start": "2025-10-24", "end": "2025-10-30" }
      }
    },
    { "view": "chart.compare" }
  ],
  "expect": {
    "calls": ["baseline_deviation"],
    "views": ["chart.compare"],
    "refusals": []
  }
}
```

`script` is what a scripted model tries, in order. The gate applies the skill and the
policy, and the outcome must equal `expect`: the calls and views that ran, in order,
and the refusals. `provider` defaults to `ollama`, `dataMode` to `synthetic`,
`exoscalePersonalData` to `off`, `wearableContext` to `false`, `genomeSource` to
`none`.

Refusal codes:

- `provider-not-allowed-by-skill`: the provider is not in `providers`.
- `source-not-allowed`: the turn has wearable context and the skill does not list it.
- `provider-not-permitted-for-data-mode`: the data-mode policy refuses the provider.
- `tool-not-allowed`: the tool is not in `tools`.
- `invalid-tool-input`: the query tool's own schema rejects the input.
- `view-not-allowed`: the view kind is not in `views`.
- `genome-not-permitted`: a genome tool outside `dataMode: personal` with
  `genomeSource: ark` on `ollama`.

The first three refuse the whole request and nothing runs. Cases may only name subjects
from the synthetic question set (`evaluation/questions.v1.json`).

## Checking

`bun run skills:check` validates every skill and runs its cases, with no network and no
real model. `bun test` runs the same check (`features/skills/skills.test.ts`), so a
malformed skill or a failing case fails CI.

The check tests the format and the gate, not a model's judgement. How well a real model
follows a skill is measured with the evaluation harness, as for the question set.

## Running a skill

The server reads `skills/` once per process (on every request in development) and
offers a skill only if it validates and every case passes; anything else is logged and
left out (`features/skills/load-skills.ts`). The `/` palette lists the offered skills
under "Skills" with their description, the sources they read and the tools they may
call, so a person sees that before running one.

Picking a skill writes `/sleep ` into the prompt; a prompt that starts with an offered
skill is sent tagged with it, and the rest of the text is the question (the skill's
description when there is none). On `POST /api/chat` the server, before any model call:

1. refuses a skill it does not offer (`skill-not-offered`);
2. refuses a provider the skill does not list (`provider-not-allowed-by-skill`) and
   wearable context the skill does not read (`source-not-allowed`), each with a sentence
   that names the skill, shown in the answer column;
3. applies the data-mode policy as for any turn;
4. writes a `skill.<name>` audit row (skill, model, provider, allowlists; no prompt).

The turn then gets only the skill's tools, intersected with the user's sources and what
the data-mode policy left (`show_view`, `list_views` and `open_view` stay when the skill
allows a kind `show_view` draws: `chart.timeseries`, `chart.compare`, `biomarker.card` or
`table`; `show_view` refuses any other kind and the other two offer only the allowed kinds), and the skill's instructions at the end of the system prompt.
The response document records `skill`, and the prompt shows a `/sleep` chip, also after
a reload, where it is read back from the audit row. The shared rules live in
`infrastructure/skill-gate.ts`, which the eval gate uses too.

## /trainer

> Draft — for Martin's review.

`skills/trainer` (#46) describes recovery or readiness, HRV, resting heart rate, sleep and
workouts against the person's own previous four weeks, and never says what to do. A daily
check-in compares the latest 7 days with the 28 before them through `hrv_trend`,
`resting_hr_trend`, `sleep_summary` and `training_load` (recent load compared with the
previous four weeks), and reads the vendor's readiness or recovery score from the
Available keys. A weekly review adds `chart.timeseries` charts. Every number names its
source; sources are never pooled. With no linked wearable and no synthetic subject it
says so in one sentence and stops. In synthetic mode it reads a named subject's synthetic
series; a date in the question, or `subject_window` and a first `hrv_trend`, give the day
that series ends. The chat stops after 8 steps, so a weekly review draws at most two
charts (one for a synthetic subject).

Its instructions rule out a training plan or suggestion ("push", "steady", "recover",
"you should"), injury or illness prediction, a label for the person's state and medical
claims. A question about whether or how to train gets one sentence saying /trainer does
not say that, then the check-in; a question about a dose, supplement, medicine or plan
gets one sentence and no tool call. Resting heart rate well above its previous four weeks
with HRV well below is stated plainly with "If this concerns you, talk to a clinician."
and nothing more. Local Ollama only. The eval cases cover a normal day, a weekly review,
no linked wearable, "should I train today?", a dose question, hosted providers, views it
may not draw and an unknown source; `features/skills/skills.test.ts` checks that the
rule sentences stay in the skill. Goals the person sets (#46) are not part of v1.

## /nutrition

`skills/nutrition` (#218) is the Diet specialist agent's skill and can be typed as
`/nutrition`. It describes body weight (29463-7), BMI (39156-5), glucose (2339-0), HbA1c
(4548-4) and the lipids (total 2093-3, LDL 18262-6, HDL 2085-9, triglycerides 2571-8) of
a named synthetic subject against their own earlier values. It starts with
`subject_window` and uses the subject's whole date range as the window, so a reading is
never missed by a guessed window; `observations_for_subject` lists the readings. Then: the
latest reading
(`latest_by_loinc`), the change over that window (`trend`), the last 90 days against the year
before (`baseline_deviation`), how sparse the readings are (`coverage`), one reading against
its Anchor v3 published range (`range_position`, said only as below, within or above) and
what was recorded around a named condition or medication (`values_around_event`). It may
draw one `chart.timeseries` or one `biomarker.card`. `knowledge_search` only explains a
measure. A question asking for a diet, meal plan, food list, calorie or macro target,
supplement, medicine or dose gets one fixed sentence and no tool call. It never names a
target value and never labels the person. It lists `wearable-context` so that a turn with
a linked wearable is not refused; a body weight key in the Available keys may be reported
with its date. Local Ollama only. The eval cases cover a weight change, every weight reading over the subject's window, lipids against the
range, HbA1c against a baseline with a chart, glucose around a condition, a meal plan
request, tools and views it may not use, and a hosted provider.

## /anatomy

`skills/anatomy` (#218) is the Anatomy specialist agent's skill and can be typed as
`/anatomy`. It explains where an organ or body system is and which Anchor biomarkers the
biomarker catalogue lists for that system or region, through `knowledge_search` over the
OpenTwin notes only. It reads no values and no records. No view fits: `twin.body` is not a
kind `show_view` can draw, so the skill points to the Digital Twin page instead. A
question asking whether something is wrong with an organ, or what a pain or a value means
for it, gets one fixed sentence ending "If this concerns you, talk to a clinician." and
no tool call. It lists `wearable-context` only so that a turn with a
linked wearable is not refused; its instructions say not to describe it. Local Ollama
only. The eval cases cover an organ's place, a system's markers, a turn with linked
wearables, a "is my liver damaged?" question, tools and views it may not use, and a
hosted provider.

## Built-in commands

Built-ins live in `features/commands/registry.ts`. A skill may not take a built-in's name.

- `/connect` shows the wearable rows under the prompt.
- `/twin` shows the thread's digital twin as a card in the conversation (#168). Picking
  it, or sending `/twin` on its own, clears the prompt and asks no model: it starts no
  turn, never calls `/api/chat`, and the card is not part of the history any model is
  sent (`features/arena/prompt-route.ts`, `twin-card-state.ts`).

Which twin the card shows (`features/arena/twin-subject.ts`):

- With `DATA_MODE=synthetic`, the first synthetic subject the thread used: a
  `subject_ref` in one of its tool calls, or a subject_ref in a prompt, when that person
  is in the synthetic cohort the Demo body lists. Synthetic people have no scan, so they
  are shown on the Demo body with their lab values, as on the Digital Twin page. With
  no such person, the Demo body.
- With `DATA_MODE=personal`, Self, as the Digital Twin page shows it. When there is no
  Self twin the viewer falls back as the page does, and the label says what it shows.

The card names the twin in its header, reuses the Digital Twin page's body viewer in a
shorter view, and loads it only when a card opens, so the chat does not load three.js
until then. It collapses to a one-line chip or closes. A second `/twin` reopens the
same card and scrolls to it. Its place and collapsed state are kept per thread in
sessionStorage, never in the database. Reading the synthetic cohort list for the label
is audited like the Digital Twin page's read (`biomarkers.cohort.list`).

## Your own skills (#174)

Customize · Skills has a form for making a skill without a SKILL.md: a name, one sentence on what it does, instructions, the sources it reads and the tools it may call, the views it may draw and where its model may run (local models unless more are ticked). It is held to the same schema as a SKILL.md frontmatter (`skillFrontmatterSchema`): a tool needs its source, genome tools and wearable context never list a provider the data-mode policy would refuse, and a skill only narrows what a turn allows.

- Stored per person in `user_skills` (`features/skills/user-skill-store.ts`); only the owner lists, runs, edits or deletes it. At most 50 per person.
- It may not take the name of a shipped skill or a built-in command, so `/sleep` always means the shipped one.
- The palette, search and the chat route find shipped skills first, then the person's own (`findSkillFor`). A stored row is checked again before it runs, so one that breaks today's rules does not run.
- It has no eval cases; Customize and the palette say "Yours · not evaluated". It runs under the same gate and `skill.<name>` audit as a shipped skill.
