# Clinical research framing

What TwinLLM is for, what it is not for, and what would change that. Issue #243, part
of #210.

> Orientation only. The regulatory statements below are our reading, not a regulatory
> assessment. Verify them against the current texts before relying on them: EU MDR
> 2017/745, MDCG 2019-11 (software qualification and classification), the Swiss Medical
> Devices Ordinance (MedDO), and the FDA guidance on clinical decision support software
> and on general wellness products.

## Intended purpose

TwinLLM is research software. It is for studying how open language models answer
questions about coded health data, on synthetic people. It is not for the diagnosis,
prevention, monitoring, prediction, prognosis, treatment or alleviation of disease in
any person. It does not interpret one person's data for a medical purpose, and nobody
should use it to decide anything about their own health or someone else's.

The default data is synthetic: the Synthea cohort (`synthea-v4-seed42`), synthetic
wearables and the demo bodies. Personal mode exists so a researcher can look at their
own export on their own machine. The purpose stays the same there.

## In silico

A synthetic person is a simulation whose truth we know. We wrote the conditions, the
onset dates and the measurements, so we can check an answer against them. That is the
point of the evaluation: we measure whether the pipeline (tools, prompt, model, agent)
recovers what we put in. A wrong answer is a finding about the pipeline, not about a
patient.

This only works because nobody's care depends on it. The questions, the scores and the
training sets all come from simulated people.

## What would make it a medical device

Software is a medical device when its maker intends it for a medical purpose for an
individual. Under the MDR, the intended purpose is read from the labelling, the
instructions, the promotional material and the way the product presents itself, not
only from a disclaimer.

TwinLLM would cross that line if it offered to interpret one person's data for a
medical purpose. Examples: telling someone their rhythm suggests atrial fibrillation,
that a lab value calls for a medicine, or what dose to take.

Under MDR Annex VIII, Rule 11, software that gives information used to take diagnostic
or therapeutic decisions is typically class IIa or higher. That class needs, among
other things:

- a quality management system (ISO 13485);
- a software life cycle process (IEC 62304);
- risk management (ISO 14971);
- usability engineering (IEC 62366-1);
- a clinical evaluation with clinical data;
- a conformity assessment by a notified body.

TwinLLM has none of these, and this project does not plan to. So it must not offer
that function.

## Why agent names matter

A name is part of the presentation. An agent called "General Practitioner" reads as a
doctor, and a doctor has a medical purpose, whatever the prompt says below it. That is
why the agent is now called General (`docs/agents.md`). Its internal id stays `gp` so
stored threads, router fixtures and literature sources keep working.

Diet specialist and Anatomy specialist keep their names. "Specialist" there means the
agent looks at one area of the record. It is not a clinical title. Sleep, Trainer and
Genetics name a topic, not a profession. So do Heart rhythm (research) and Brain
(research) (#253), not cardiologist or neurologist; their role lines say they describe data
and literature and never say what a person has.

The same rule applies to new copy: describe what the software reads and shows. Do not
name a clinical role or say what a person has or should take. `bun run lint:claims`
checks the most common wording; it is a floor, not a review.

## Rhythm work stays research

The planned rhythm work adds beat-level data to synthetic people:

- #244 simulates RR intervals for synthetic people, including atrial fibrillation and
  ectopic beats, with every parameter cited.
- #245 lets synthetic wearables follow a synthetic person's Synthea conditions.
- #246 adds a tool that describes how irregular a recording is (RMSSD, entropy,
  turning points, burden), with a research-labelled threshold and its source.

These stay research if they keep to two rules. They describe a recording, never a
person: "this 60 s recording has a normalised RMSSD of 0.12", not "you may have atrial
fibrillation". And they run on simulated people, so the evaluation can ask whether the
tool recovers the episodes we simulated. A tool that told a real person they have a
condition would have a medical purpose, and the section above applies.

## Population estimates stay calm

`gbd_estimate` reads IHME GBD population estimates (#387, #394). A figure for
Switzerland or the world says how a population fares on average. It is not a
person's risk, and it says nothing about the person asking.

When a question names no measure, the tool leads with measures of living well:
healthy life expectancy (HALE), life expectancy, then DALYs, YLDs and
prevalence. Deaths come only when the question asks for deaths. A question
about health in a country is usually a question about how long and how well
people live there, and leading with death counts reads as alarm the data does
not support.

The map follows the same idea. Its colours are one neutral scale, never a red
alarm scale; a stronger colour is always a higher value (darker in the light
theme, brighter in the dark one), and the legend says which way is
better (higher for HALE and life expectancy, lower for burden measures).

## See also

- [agents.md](agents.md) for the roster and the router.
- [twin-llm.md](twin-llm.md) for the product.
- open-twin's [intended use](https://github.com/Opening-Science/open-twin/blob/main/docs/INTENDED-USE.md).
