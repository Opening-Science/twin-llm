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
agent counts as one of the one to three picks. A new chat never picks an agent by default.

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

Version 1 rules. Each specialist has a few topics; a topic matches on keywords or on its
LOINC codes:

| Agent              | Topics (keywords and LOINC codes)                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diet specialist    | body weight (weight, 29463-7); BMI (39156-5); blood glucose (glucose, blood sugar, 2339-0); HbA1c (A1c, glycated, 4548-4); blood lipids (cholesterol, lipids, LDL, HDL, triglycerides, 2093-3, 18262-6, 2085-9, 2571-8); food and diet |
| Anatomy specialist | anatomy; where an organ is (organ, liver, kidney, pancreas, spleen, gallbladder, thyroid, stomach, lung, bladder, bowel, heart but not heart rate); a body system (skeleton, muscle, bone, circulatory, digestive, nervous, endocrine) |
| Sleep              | sleep (sleep, slept, night, insomnia, nap, REM, bedtime, 93832-4)                                                                                                                                                                      |
| Trainer            | recovery (recovery, readiness); heart rate variability (HRV); resting heart rate (RHR, 40443-4); training (train, workout, exercise, run, strain, check-in, weekly review)                                                             |
| Genetics           | the genome (gene, genetic, genome, genotype, DNA, variant, SNP, rs numbers)                                                                                                                                                            |

The agent with the most matching topics wins; a tie goes to the one listed first in the
roster; no match, or a match only for an agent not offered here, goes to the General
Practitioner. The answer column reads "Auto → Diet specialist", and one muted line under
it says why: "Auto chose Diet specialist: the question is about body weight." or "Auto
chose General Practitioner: no specialist agent here matched the question."

The turn stores the column name when it starts (`checkTurnRequest`), and `/api/chat` runs
Auto as the agent that name holds while it is still offered, so a retry runs as the agent
the header shows. An incognito turn routes the prompt in the request. The muted line is
found again from the prompt and the stored name, so a reload shows the same line.

`evaluation/agent-router.v1.json` holds 26 prompts with the agent each should go to; the
test in `infrastructure/agent-router.test.ts` requires at least 90% of them to route as
expected (all 26 do today). The prompts were written alongside the rules, so the number
says the rules do what they say, not how they do on questions people ask. The scored
question set (`evaluation/questions.v1.json`) is not changed or tagged.

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
this fixture before it replaces the rules. Specialty literature for each agent is #220.
