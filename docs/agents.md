# Agents

An agent is a named preset over what TwinLLM already has: a model the active provider
offers and, for a specialist, one of the shipped skills. It adds no tool or permission;
the one thing it widens is what `knowledge_search` reads: the agent's own specialty
literature ([below](#literature-236)). Issues #218, #219, #236 and #253, part of #210.

```ts
type Agent = { id; name; role; skill: string | null; modelPreference: readonly string[] };
```

The list lives in `infrastructure/agents.ts`.

| Agent                   | Skill        | Role                                                                                                                                                                            |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General                 | none         | Looks at the whole record and says when a question is better asked of one of the specialist agents.                                                                             |
| Diet specialist         | `/nutrition` | Describes body weight, BMI, glucose, HbA1c and blood lipids against the person's own earlier values, without meal plans, diets or doses.                                        |
| Anatomy specialist      | `/anatomy`   | Explains where organs and body systems sit and which of them the Anchor biomarkers relate to, as reference anatomy rather than the person's own body.                           |
| Sleep                   | `/sleep`     | Describes sleep against the person's own recent nights.                                                                                                                         |
| Trainer                 | `/trainer`   | Describes recovery, heart rate variability and training load against the person's previous four weeks.                                                                          |
| Genetics                | `/genome`    | Describes the genome report the person released, one variant at a time.                                                                                                         |
| Heart rhythm (research) | `/rhythm`    | Describes heart rate, heart rate variability and recorded rhythm conditions in the data and in the cardiology literature, and never says what rhythm or condition a person has. |
| Brain (research)        | `/brain`     | Describes recorded stroke, cognition and autonomic data and the neurology literature, and never says what condition a person has.                                               |

The picker lists them in this order, under Auto (below). The skills are described
in [skills.md](skills.md#nutrition). Every agent prefers `qwen3:8b`, then `qwen3:4b`, then
the catalog's first model.

The first agent was called General Practitioner until #243. A clinical role name reads as
a medical purpose, so it is now General; its id stays `gp`. Diet specialist and Anatomy
specialist keep "specialist" as a plain word for one area of the record. Why names matter,
and what the app is for: [clinical-research.md](clinical-research.md).

### Heart rhythm and Brain (#253)

The two newest agents carry "(research)" in their names, since their topics sit closest to
a medical purpose. Each describes recorded data and published literature and never says
what a person has: their skills answer "do I have atrial fibrillation?" or "does this
score mean dementia?" with one fixed sentence and no tool call
([skills.md](skills.md#rhythm-and-brain)).

The issue asked for "Brain and sleep (research)". Sleep already has its own agent, skill,
literature and training track, so a second agent covering sleep would split those
questions between two agents for no gain. The agent is called Brain (research) and covers
stroke and cerebrovascular records, cognition scores and the autonomic nervous system.
Sleep and cognition together still go to Sleep on a tie (below), and the neurology
literature query keeps sleep studies only where they are about cognition.

The rhythm tool being built for #246 (`rhythm_irregularity`) is not part of `/rhythm` yet;
the skill uses the wearable and record tools that exist today and gets the new tool when
it lands.

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
provider only Auto and the General agent are offered.

The picker lists the agents under "Agents", Auto first, each with its base model in small
text (Auto says it picks an agent for each question), and the models under "Models". An
agent counts as one of the one to three picks.

A new chat, an incognito chat and the first question on `/start` start with the General
agent, the Diet specialist and the Anatomy specialist, as many of them as the
catalog offers, topped up with the usual one model per vendor (`defaultModelSelection`).
On local Ollama that is the three agents; on a hosted provider it is the General
agent and two models. The models page and the starter questions read the catalog
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
  name, so the column reads "General". Audit rows name the base model,
  which is the one that saw the data.

A reloaded turn reads its `/skill` chip back from the skill audit row, which is per turn,
so an agent's own skill shows as a chip there too.

## Auto (#219)

"Auto" (`agent:auto`) heads the Agents list. It is not an agent of its own: for each turn
a pure router (`infrastructure/agent-router.ts`) picks one of the agents offered here from
the prompt, and the turn runs as that agent exactly as if it had been picked by hand: its
base model, its skill through the skill gate, its refusal sentences and its audit rows.
The skill row adds `via: "auto"`. No model is called to choose.

Version 3 rules. A question that asks for a medicine or dose decision goes to the General
agent before any specialist is looked at, since no specialist gives a dose or says
what to take, start or stop: "dose" or "dosing", "how many milligrams" or "how many
units", or "should" followed in the same sentence by take, start, stop, change, replace,
inject, double, see a doctor or go to hospital. So does a question that names a
guideline, since only the General agent searches the guideline library (version 3).
Otherwise each specialist has a few topics; a topic matches on keywords or on its LOINC
codes:

| Agent                   | Topics (keywords and LOINC codes)                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diet specialist         | body weight (weight, 29463-7); BMI (39156-5); blood glucose (glucose, blood sugar, 2339-0); HbA1c (A1c, glycated, 4548-4); blood lipids (cholesterol, lipids, LDL, HDL, triglycerides, 2093-3, 18262-6, 2085-9, 2571-8); food and diet                                                                                                             |
| Anatomy specialist      | anatomy; where an organ is (organ, liver, kidney, pancreas, spleen, gallbladder, thyroid, stomach, lung, bladder, bowel, heart; not heart rate, heart rhythm or heart beat, and not an organ followed by disease, failure or cancer); a body system (skeleton, muscle, bone, circulatory, digestive, nervous but not autonomic nervous, endocrine) |
| Sleep                   | sleep (sleep, slept, night, insomnia, nap, REM, bedtime, 93832-4)                                                                                                                                                                                                                                                                                  |
| Trainer                 | recovery (recovery, readiness); heart rate variability (HRV); resting heart rate (RHR, 40443-4); training (train, workout, exercise, a run, runs, running, jog, swim, cycling, bike, rowing, sport, strain, check-in, weekly review)                                                                                                               |
| Genetics                | the genome (gene, genetic, genome, genotype, DNA, variant, SNP, rs numbers)                                                                                                                                                                                                                                                                        |
| Heart rhythm (research) | atrial fibrillation (atrial fibrillation, AF, AFib); heart rhythm (arrhythmia, rhythm but not circadian rhythm, palpitations, ectopic, heartbeat, tachycardia, bradycardia); RR intervals (RR or R-R interval, inter-beat); heart rate variability (HRV, 80404-7)                                                                                  |
| Brain (research)        | stroke (stroke, cerebrovascular, TIA, transient ischaemic); cognition and memory (cognition, dementia, Alzheimer, memory, MMSE, 72106-8); the autonomic nervous system (autonomic, heart-brain)                                                                                                                                                    |

The agent with the most matching topics wins; a tie goes to the one listed first in the
roster, so HRV alone stays with Trainer (listed before Heart rhythm) and HRV with a rhythm
word goes to Heart rhythm; no match, or a match only for an agent not offered here, goes to the General
agent. The answer column reads "Auto → Diet specialist", and one muted line under
it says why: "Auto chose Diet specialist: the question is about body weight." or "Auto
chose General: no specialist agent here matched the question." A medicine or dose decision
reads "Auto chose General: the question is about a medicine or dose decision."

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
   decline): General.
2. A genome tool (`genome_report`, `dna_ask`, `genome_variants`): Genetics.
3. `sleep_summary`: Sleep.
4. `hrv_trend`, `resting_hr_trend` or `training_load`: Trainer.
5. LOINC codes, all of them Diet measures (body weight, BMI, glucose, HbA1c, total, LDL
   and HDL cholesterol, triglycerides, and the serum glucose and HPLC HbA1c codes the set
   also accepts): Diet specialist.
6. Anything else (blood pressure, heart rate, kidney and blood markers, conditions,
   medications, a panel mixing Diet and other measures, no code at all): General.

Tools are the item's `must_call` and the tools its keyed values are read with; codes are
the LOINC codes in those values' arguments and in `measures`. That gives 83 General, 29 Diet, 13 Trainer and 5 Sleep. No scored question calls an anatomy or
genome tool, so this fixture says nothing about the Anatomy specialist or Genetics.

| Rules     | `agent-router.v1.json` | `agent-router.questions.v1.json` |
| --------- | ---------------------- | -------------------------------- |
| Version 1 | 26/26 (100%)           | 117/130 (90.0%)                  |
| Version 2 | 26/26 (100%)           | 126/130 (96.9%)                  |
| Version 3 | 36/36 (100%)           | 126/130 (96.9%)                  |

Version 2 came from the version 1 misses on the questions: seven medicine or dose decisions (a
metformin or statin dose, insulin units, "should ... see a doctor", "go to hospital")
went to the Diet specialist because they named HbA1c, LDL or weight; "chronic kidney
disease" counted as the kidney's anatomy; "run a SQL query" counted as training; and
"swim" was not a sport. Each fix is a general rule written down above, not the question's
wording, but it was found on these questions, so 96.9% is measured on the set the rules
were tuned on and overstates how they do on new questions.

Version 3 (#253) adds the Heart rhythm and Brain topics, ten hand-written prompts for them
(atrial fibrillation, RR intervals, palpitations, HRV with arrhythmia, HRV alone staying
with Trainer, stroke, MMSE, autonomic, and two medicine questions that must stay with the
General agent), and the guideline rule. No labelling rule changed: no scored question
calls a tool only these agents use, so the 130-question fixture is rebuilt unchanged and
says nothing about them. Without the guideline rule three guideline library questions
would move: Q-S3-04 (the EAN dementia guideline) and Q-S3-06 (rehabilitation after
stroke) to Brain, and Q-S3-09 (supraventricular tachycardia) to Heart rhythm, for 123/130.
With it every question routes as under version 2, with the same four misses.

The four that still miss:

- Q-S2-12 asks how complete a ten-marker panel is (sodium to HbA1c). The router sees
  glucose and HbA1c and picks the Diet specialist; the label says General
  because the panel is mostly not Diet measures. Counting non-Diet markers would need a
  list of every lab name, so it is left.
- Q-S6-07, Q-S6-08 and Q-S6-14 ask for an Oura readiness or Whoop recovery score that no
  tool holds (they are refusal probes). They carry no tool and no code, so the label falls
  to the General agent, while the router reads "readiness" and "recovery" and picks
  Trainer, whose role covers both. That is a limit of labelling from tools, not a router
  error we want to fix.

## Literature (#236)

On an agent's turn `knowledge_search` reads the OpenTwin notes and that agent's
literature, the open-access PMC articles `bun run literature:ingest` put into the
guideline tables ([literature.md](literature.md)):

| Agent                                   | Literature sources                    |
| --------------------------------------- | ------------------------------------- |
| General                                 | every `literature:<specialty>` source |
| Diet, Anatomy, Sleep, Trainer, Genetics | its own one, e.g. `literature:diet`   |
| Heart rhythm (research)                 | `literature:cardiology`               |
| Brain (research)                        | `literature:neurology`                |
| Auto                                    | the agent it picked, as above         |
| a plain model (no agent)                | none; the notes alone, as before      |

The mapping is `literatureSourcesForAgent` (`packages/literature/specialties.ts`); an agent
whose id is not a specialty name reads the one `specialtyForAgent` gives it; the
chat route passes the agent's id to `createChatTools`. `knowledge_search` was chosen over
`guideline_search` because it is the search every agent has: the specialists' skills
list `knowledge_search` and not `guideline_search`, and adding a tool to a skill would go
around the skill gate. `guideline_search` is unchanged and still reads the guideline
corpus alone wherever a turn offers it (the General agent, plain models).

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

## Roster page (#221)

Customize · Agents (`/customize/agents`) lists every agent, offered here or not, and
explains Auto. It is a Customize tab, next to Skills, because an agent is a preset over a
skill and a model; the Models page stays the provider's catalog and the sidebar gets no new
entry. Each card shows the role line, the base model it runs on here (or that it is not
offered with this provider), its skill and number of tools, its literature specialty with
the number of articles in the local index, the topics Auto sends it, its answers in your
own threads (how many went through Auto, the last one, the summed cost) and one line on
what it does not do. The Auto section says the rules in plain words and gives the share of
each router fixture routed as labelled (126 of 130 and 36 of 36 today), with the note that
the rules were tuned on them.

An agent's page (`/customize/agents/<id>`) adds the skill's sources and tools, the model
preference, the router fixtures per scenario (labelled for this agent and sent here, and
labelled for another agent but sent here) and the evaluation scores of its base model per
scenario from the runs under `evaluation/runs/` that the Lab reads. The harness calls the
base model, not the agent, so the page says these are the model's scores without the
agent's skill or literature; agent runs in the harness are still to come.

Everything is read from the code that runs a turn (`agents.ts`, `agent-router.ts`, the
skill, `literatureSourcesForAgent`), so the page cannot claim what the chat does not do.
The shaping is pure (`features/agents/roster.ts`, tested); `load-roster.ts` reads only
counts, sums and dates (answers grouped by row id and column name, documents per
`literature:<specialty>` source), never prompt or answer text. The "does not do" lines are
in `roster.ts` and follow each skill's own rules. Issue #221 also asked for eval scores per
agent; until the harness can run an agent, the router fixtures and the base model's runs
are the honest numbers.

## Model names

Our own fine-tunes are listed by a readable name (`infrastructure/model-names.ts`):
`twinllm-<base>-<tag>` reads "TwinLLM <size> (<tag>)", so `twinllm-qwen3-4b-base`,
`twinllm-qwen3-4b-pilot` and `twinllm-qwen3-4b-pilot1` are "TwinLLM 4B (base)",
"TwinLLM 4B (pilot)" and "TwinLLM 4B (pilot 1)". The raw id stays in small text under the
name in the picker and in the answer column.

## Later

Heart rhythm and Brain have no training track yet (`--track`): a track needs its own
conversation families (a rhythm or stroke question over the synthetic record), hand-over
topics in every other track and new golden counts, which is more than adding a row.

Training tracks per agent come next: each agent gets its own slice of the training data,
generated from the questions its skill answers (the router's topics give a first cut of
which questions those are), and its own fine-tune, which then becomes the first entry of
that agent's `modelPreference`. A later router may use a model call, measured against
these fixtures before it replaces the rules. Specialty literature for each agent is #220
(fetch and ingest) and #236 (search, above).
