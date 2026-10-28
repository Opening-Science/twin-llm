# Agents

An agent is a named preset over what TwinLLM already has: a model the active provider
offers and, for a specialist, one of the shipped skills. It adds no tool or permission;
the one thing it widens is what `knowledge_search` reads: the agent's own specialty
literature ([below](#literature-236)). Issues #218, #219 and #236, part of #210.

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
- `knowledge_search` also reads the agent's specialty literature ([below](#literature-236));
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

## Literature (#236)

On an agent's turn `knowledge_search` reads the OpenTwin notes and that agent's
literature, the open-access PMC articles `bun run literature:ingest` put into the
guideline tables ([literature.md](literature.md)):

| Agent                                   | Literature sources                    |
| --------------------------------------- | ------------------------------------- |
| General Practitioner                    | every `literature:<specialty>` source |
| Diet, Anatomy, Sleep, Trainer, Genetics | its own one, e.g. `literature:diet`   |
| Auto                                    | the agent it picked, as above         |
| a plain model (no agent)                | none; the notes alone, as before      |

The mapping is `literatureSourcesForAgent` (`packages/literature/specialties.ts`); the
chat route passes the agent's id to `createChatTools`. `knowledge_search` was chosen over
`guideline_search` because it is the search every agent has: the specialists' skills
list `knowledge_search` and not `guideline_search`, and adding a tool to a skill would go
around the skill gate. `guideline_search` is unchanged and still reads the guideline
corpus alone wherever a turn offers it (the General Practitioner, plain models).

Notes and literature get separate slots (`mergeKnowledgeSlots`), so papers cannot push
the notes, the biomarker catalogue among them, out of a short list: one nearest-neighbour
search over the notes and one over the agent's literature, then up to ceil(k/2) notes
first and literature in the rest. When one side has fewer passages, the other fills the
remaining slots. Rows of any other source are dropped.

Each literature hit (`packages/literature/hit.ts`) carries `kind: "literature"`, the
article title, journal, year, PMC id, URL, DOI, the licence and its label ("CC BY-NC-ND"),
the section, the passage as stored (the title the ingest puts in front of a chunk is taken
off again, nothing else is changed), an `attribution` line to put next to any quote, a
`quoting` rule and `about`, which says the passage is reference material and not about the
person. The rule is "quote only word for word, with the attribution line"; for the two
NoDerivatives licences (CC BY-ND, CC BY-NC-ND) it adds that a quote may not be shortened,
reworded or translated. A row whose PMC id or licence cannot be read is not shown. The tool
text names the literature only on an agent's turn, so the prompt and the tool snapshots of
other turns are unchanged.

Literature is never person-level evidence. The call is audited as
`knowledge.knowledge_search`, a reference tool, so it cannot make an answer
`sufficient_data` or `analytics`. Its citations (no passage) go to the response
document's `sources.literature`, which keeps a literature-only answer from being withheld
and gives it the reason `literature_only` ("Only published articles support this
answer."), and the panel lists each article once under "Literature" as title · PMC id ·
licence, with "Open-access articles from PubMed Central (NLM), each under its own licence.
Reference material, not a statement about this person." See
[response-schema.md](response-schema.md).

A source toggle that turns `knowledge_search` off turns the literature off with it; there is
no separate toggle yet.

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
this fixture before it replaces the rules. Specialty literature for each agent is #220
(fetch and ingest) and #236 (search, above).
