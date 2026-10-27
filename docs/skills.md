# Skills

A skill is data plus tests: a folder under `skills/` with a `SKILL.md` and an `evals/`
folder of cases. It says what a command may read and use; the code decides what actually
runs. Plan: [chat-platform.md](chat-platform.md), section 2. Issue #41.

The `/` palette lists them and the chat runs them (#42); see "Running a skill" below.

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
allows `chart.timeseries`; `show_view` refuses any other kind and the other two offer only
the allowed kinds), and the skill's instructions at the end of the system prompt.
The response document records `skill`, and the prompt shows a `/sleep` chip, also after
a reload, where it is read back from the audit row. The shared rules live in
`infrastructure/skill-gate.ts`, which the eval gate uses too.
