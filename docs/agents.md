# Agents

An agent is a named preset over what TwinLLM already has: a model the active provider
offers and, for a specialist, one of the shipped skills. It adds no tool, source or
permission. Issues #218 and #219, part of #210.

```ts
type Agent = { id; name; role; skill: string | null; modelPreference: readonly string[] };
```

The list lives in `infrastructure/agents.ts`.

| Agent                | Skill        | Role                                                                                                                                                  |
| -------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| General Practitioner | none         | Looks at the whole record and says when a question is better asked of one of the specialist agents.                                                   |
| Diet specialist      | `/nutrition` | Describes body weight, BMI, glucose, HbA1c and blood lipids against the person's own earlier values, without meal plans, diets or doses.              |
| Anatomy specialist   | `/anatomy`   | Explains where organs and body systems sit and which of them the Anchor biomarkers relate to, as reference anatomy rather than the person's own body. |
| Sleep                | `/sleep`     | Describes sleep against the person's own recent nights.                                                                                               |
| Trainer              | `/trainer`   | Describes recovery, heart rate variability and training load against the person's previous four weeks.                                                |
| Genetics             | `/genome`    | Describes the genome report the person released, one variant at a time.                                                                               |

The picker lists them in this order, under Auto (below). The two new skills are described
in [skills.md](skills.md#nutrition). Every agent prefers `qwen3:8b`, then `qwen3:4b`, then
the catalog's first model.

## In the catalog

`withAgents` (`infrastructure/model-catalog.ts`) puts one row per agent in front of the
provider's models, with the id `agent:<id>` and the agent's name. Its provider and
context window are copied from its base model: the first id in `modelPreference` the
catalog offers, else the catalog's first model. With no model there are no agents. An
Auto row (`agent:auto`) goes in front of them whenever there is at least one; it copies
the first agent's row.

An agent with a skill is offered only when that skill could run here (`agentIsOffered`):
the skill must be one the server offers, the active provider must be in its `providers`
(the skill gate's rule), and a skill that asks for genome tools also needs a local chat
model ([genome.md](genome.md)). The shipped skills list local Ollama only, so on a hosted
provider only Auto and the General Practitioner are offered.

The picker lists the agents under "Agents", Auto first, each with its base model in small
text (Auto says it picks an agent for each question), and the models under "Models". An
agent counts as one of the one to three picks.

A new chat, an incognito chat and the first question on `/start` start with the General
Practitioner, the Diet specialist and the Anatomy specialist, as many of them as the
catalog offers, topped up with the usual one model per vendor (`defaultModelSelection`).
On local Ollama that is the three agents; on a hosted provider it is the General
Practitioner and two models. The models page and the starter questions read the catalog
without agents, so they keep models only.

## In a turn

The chat routes (`/api/chat` and `/api/chat/incognito`) check `agent:<id>` against the
same catalog, then:

- the model called is the agent's base model;
- the agent's skill applies when the prompt names none, and a `/skill` in the prompt wins.
  The skill goes through every check a typed one does, and the `skill.<name>` audit row
  is written with the agent's id added. When the agent's own skill is refused for its
  provider, or not offered, the sentence names the agent: "Sleep isn't available here:
  its /sleep skill runs only on local Ollama.";
- the system prompt gets one line, `Agent: <name>. <role>`, under its first line;
- the answer row keeps `agent:<id>` as its model id and the agent's name as its model
  name, so the column reads "General Practitioner". Audit rows name the base model,
  which is the one that saw the data.

A reloaded turn reads its `/skill` chip back from the skill audit row, which is per turn,
so an agent's own skill shows as a chip there too.

## Auto (#219)

"Auto" (`agent:auto`) heads the Agents list. It is not an agent of its own: for each turn
a pure router (`infrastructure/agent-router.ts`) picks one of the agents offered here from
the prompt, and the turn runs as that agent exactly as if it had been picked by hand: its
base model, its skill through the skill gate, its refusal sentences and its audit rows.
The skill row adds `via: "auto"`. No model is called to choose.

Version 2 rules. A question that asks for a medicine or dose decision goes to the General
Practitioner before any specialist is looked at, since no specialist gives a dose or says
what to take, start or stop: "dose" or "dosing", "how many milligrams" or "how many
units", or "should" followed in the same sentence by take, start, stop, change, replace,
inject, double, see a doctor or go to hospital. Otherwise each specialist has a few
topics; a topic matches on keywords or on its LOINC codes:

| Agent              | Topics (keywords and LOINC codes)                                                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diet specialist    | body weight (weight, 29463-7); BMI (39156-5); blood glucose (glucose, blood sugar, 2339-0); HbA1c (A1c, glycated, 4548-4); blood lipids (cholesterol, lipids, LDL, HDL, triglycerides, 2093-3, 18262-6, 2085-9, 2571-8); food and diet                                                       |
| Anatomy specialist | anatomy; where an organ is (organ, liver, kidney, pancreas, spleen, gallbladder, thyroid, stomach, lung, bladder, bowel, heart; not heart rate, and not an organ followed by disease, failure or cancer); a body system (skeleton, muscle, bone, circulatory, digestive, nervous, endocrine) |
| Sleep              | sleep (sleep, slept, night, insomnia, nap, REM, bedtime, 93832-4)                                                                                                                                                                                                                            |
| Trainer            | recovery (recovery, readiness); heart rate variability (HRV); resting heart rate (RHR, 40443-4); training (train, workout, exercise, a run, runs, running, jog, swim, cycling, bike, rowing, sport, strain, check-in, weekly review)                                                         |
| Genetics           | the genome (gene, genetic, genome, genotype, DNA, variant, SNP, rs numbers)                                                                                                                                                                                                                  |

The agent with the most matching topics wins; a tie goes to the one listed first in the
roster; no match, or a match only for an agent not offered here, goes to the General
Practitioner. The answer column reads "Auto → Diet specialist", and one muted line under
it says why: "Auto chose Diet specialist: the question is about body weight." or "Auto
chose General Practitioner: no specialist agent here matched the question." A medicine or dose decision
reads "Auto chose General Practitioner: the question is about a medicine or dose decision."

The turn stores the column name when it starts (`checkTurnRequest`), and `/api/chat` runs
Auto as the agent that name holds while it is still offered, so a retry runs as the agent
the header shows. An incognito turn routes the prompt in the request. The muted line is
found again from the prompt and the stored name, so a reload shows the same line.

### Measuring the router

Two fixtures, both checked by `infrastructure/agent-router.test.ts`, which prints the
share routed as expected and every miss:

- `evaluation/agent-router.v1.json`: 26 prompts written alongside the version 1 rules. It
  says the rules do what they say, not how they do on other questions. At least 90% must
  pass.
- `evaluation/agent-router.questions.v1.json`: the 130 scored questions of
  `evaluation/questions.v1.json`, each labelled from what the item already declares, not
  from its words (`scripts/evaluation/router-labels.ts`, rebuilt with
  `bun run eval:router-fixture`; a test checks the file matches). Each item keeps the rule
  that gave its label. At least 95% must pass. The question set itself is not changed.

The labelling rules, first that applies wins:

1. Scenario S3 (guideline library), S4 (population, GBD) or S5 (a medicine or dose decision to
   decline): General Practitioner.
2. A genome tool (`genome_report`, `dna_ask`): Genetics.
3. `sleep_summary`: Sleep.
4. `hrv_trend`, `resting_hr_trend` or `training_load`: Trainer.
5. LOINC codes, all of them Diet measures (body weight, BMI, glucose, HbA1c, total, LDL
   and HDL cholesterol, triglycerides, and the serum glucose and HPLC HbA1c codes the set
   also accepts): Diet specialist.
6. Anything else (blood pressure, heart rate, kidney and blood markers, conditions,
   medications, a panel mixing Diet and other measures, no code at all): General
   Practitioner.

Tools are the item's `must_call` and the tools its keyed values are read with; codes are
the LOINC codes in those values' arguments and in `measures`. That gives 83 General
Practitioner, 29 Diet, 13 Trainer and 5 Sleep. No scored question calls an anatomy or
genome tool, so this fixture says nothing about the Anatomy specialist or Genetics.

| Rules     | `agent-router.v1.json` | `agent-router.questions.v1.json` |
| --------- | ---------------------- | -------------------------------- |
| Version 1 | 26/26 (100%)           | 117/130 (90.0%)                  |
| Version 2 | 26/26 (100%)           | 126/130 (96.9%)                  |

Version 2 came from the version 1 misses on the questions: seven medicine or dose decisions (a
metformin or statin dose, insulin units, "should ... see a doctor", "go to hospital")
went to the Diet specialist because they named HbA1c, LDL or weight; "chronic kidney
disease" counted as the kidney's anatomy; "run a SQL query" counted as training; and
"swim" was not a sport. Each fix is a general rule written down above, not the question's
wording, but it was found on these questions, so 96.9% is measured on the set the rules
were tuned on and overstates how they do on new questions.

The four that still miss:

- Q-S2-12 asks how complete a ten-marker panel is (sodium to HbA1c). The router sees
  glucose and HbA1c and picks the Diet specialist; the label says General Practitioner
  because the panel is mostly not Diet measures. Counting non-Diet markers would need a
  list of every lab name, so it is left.
- Q-S6-07, Q-S6-08 and Q-S6-14 ask for an Oura readiness or Whoop recovery score that no
  tool holds (they are refusal probes). They carry no tool and no code, so the label falls
  to the General Practitioner, while the router reads "readiness" and "recovery" and picks
  Trainer, whose role covers both. That is a limit of labelling from tools, not a router
  error we want to fix.

## Model names

Our own fine-tunes are listed by a readable name (`infrastructure/model-names.ts`):
`twinllm-<base>-<tag>` reads "TwinLLM <size> (<tag>)", so `twinllm-qwen3-4b-base`,
`twinllm-qwen3-4b-pilot` and `twinllm-qwen3-4b-pilot1` are "TwinLLM 4B (base)",
"TwinLLM 4B (pilot)" and "TwinLLM 4B (pilot 1)". The raw id stays in small text under the
name in the picker and in the answer column.

## Later

Training tracks per agent come next: each agent gets its own slice of the training data,
generated from the questions its skill answers (the router's topics give a first cut of
which questions those are), and its own fine-tune, which then becomes the first entry of
that agent's `modelPreference`. A later router may use a model call, measured against
these fixtures before it replaces the rules. Specialty literature for each agent is #220.
