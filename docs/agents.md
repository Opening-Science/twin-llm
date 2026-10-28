# Agents

An agent is a named preset over what TwinLLM already has: a model the active provider
offers and, for a specialist, one of the shipped skills. It adds no tool, source or
permission. Issue #218, part of #210.

```ts
type Agent = { id; name; role; skill: string | null; modelPreference: readonly string[] };
```

The list lives in `infrastructure/agents.ts`.

| Agent                | Skill      | Role                                                                                                   |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| General Practitioner | none       | Looks at the whole record and says when a question is better asked of one of the specialist agents.    |
| Sleep                | `/sleep`   | Describes sleep against the person's own recent nights.                                                |
| Trainer              | `/trainer` | Describes recovery, heart rate variability and training load against the person's previous four weeks. |
| Genetics             | `/genome`  | Describes the genome report the person released, one variant at a time.                                |

## In the catalog

`withAgents` (`infrastructure/model-catalog.ts`) puts one row per agent in front of the
provider's models, with the id `agent:<id>` and the agent's name. Its provider and
context window are copied from its base model: the first id in `modelPreference` the
catalog offers, else the catalog's first model. With no model there are no agents.
Genetics is offered only when the chat model runs on this machine, because a thread that
uses the genome skill may only run there ([genome.md](genome.md)).

The picker lists the agents under "Agents", each with its base model in small text, and
the models under "Models". An agent counts as one of the one to three picks. A new chat
never picks an agent by default.

## In a turn

The chat routes (`/api/chat` and `/api/chat/incognito`) check `agent:<id>` against the
same catalog, then:

- the model called is the agent's base model;
- the agent's skill applies when the prompt names none, and a `/skill` in the prompt wins.
  The skill goes through every check a typed one does, so `/sleep` and `/trainer` still
  run only on the providers they list, and the `skill.<name>` audit row is written with
  the agent's id added;
- the system prompt gets one line, `Agent: <name>. <role>`, under its first line;
- the answer row keeps `agent:<id>` as its model id and the agent's name as its model
  name, so the column reads "General Practitioner". Audit rows name the base model,
  which is the one that saw the data.

A reloaded turn reads its `/skill` chip back from the skill audit row, which is per turn,
so an agent's own skill shows as a chip there too.

## Later

An automatic mode that picks the agent for a question is #219. Specialty literature for
each agent is #220. Neither is part of this step.
