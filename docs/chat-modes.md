# Modes and effort

How a prompt picks what answers it (the mode) and how hard each answer works (the
effort). Issue #366. Research use only: neither changes what TwinLLM is for
([clinical-research.md](clinical-research.md)).

## Modes

The mode is chosen on its own, apart from the model list. The server never sees a mode:
the prompt bar turns it into the row ids a turn goes to (`features/arena/chat-mode.ts`),
and those go through the same checks as before (`checkTurnRequest`, `/api/chat`).

| Mode    | Answers      | What it sends                                                                                                                                     |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto    | one          | `agent:auto`. The router picks the specialist for each question ([agents.md](agents.md#auto-219)) and the specialist runs on its preferred model. |
| Manual  | one to three | Each chosen specialist on each chosen model, at most three answers in all. No specialist sends the models as themselves.                          |
| Compare | two or three | The rows picked, models or specialists, side by side, as the arena has always worked.                                                             |

The interface calls the agents "specialists", never doctors, and keeps their research
labels, such as Heart rhythm (research).

A new chat starts in Auto at Balanced when the catalog offers the specialists, else in
Compare. A saved thread reopens in the mode its last ids show: Auto's one row is Auto, a
pair or a single row is Manual, anything else is Compare (every thread from before
modes). A thread with no turn yet opens like a new chat. Both read the thread's last
turn (`initialModelIds` and `initialEffort` in `chat-mode.ts`); the pages pass no
default ids, since a list of two or three ids reads as Compare (#386). In an incognito
chat Auto is offered only when its model runs on this machine.

### Specialist on a chosen model

Manual can run a specialist on a model other than the one it prefers. That row's id is
`agent:<specialist>@<model id>`, such as `agent:diet@llama3.2`, and its column reads
"Diet specialist · llama3.2". The catalog does not list such rows. `findCatalogRow`
(`infrastructure/model-catalog.ts`) builds one from the specialist's row and the model's
row, so a pair is offered exactly when both halves are, and every place that checked an
id against the catalog (the turn check, `/api/chat`, the incognito route, scheduled
tasks, `/compact`) now goes through it. Auto cannot be paired, and a specialist on its
own preferred model keeps its plain `agent:<id>` row.

### Why Auto chose

Auto's answer carries one muted line that says which specialist ran, on which model when
the screen knows it, and why: "Auto chose Diet specialist on Qwen3 4B: the question is
about body weight." The rules are in [agents.md](agents.md#auto-219).

### Which model Auto uses (#379)

Auto runs the specialist it picks on Auto's own model, not on the specialist's
preference: qwen3:4b first, then qwen3:8b, else the catalog's first model
(`AUTO_AGENT.modelPreference` in `infrastructure/agents.ts`). A specialist picked by
hand in Manual or Compare keeps its own preference (qwen3:8b first).

The rule comes from the committed eval runs
([eval-runs-2026-10.md](research/eval-runs-2026-10.md), "Tool calls and answers without
a tool"). On the v1 set qwen3:4b answered 1 of 96 keyed lines without calling a tool and
qwen3:8b 32 of 96 (18 and 65 of 134 lines in all); on S7, 1 and 2 of 32. A subject
question answered without a tool is withheld, so the model that calls tools more often
answers more of them. The live check that led here saw two Auto turns on qwen3:8b with
no tool call. The trade-offs, from the same runs: qwen3:4b invents LOINC codes more
often (46 against 29 of 96 keyed lines on v1) and writes a long reasoning passage, so
it is slower. The specialists were only evaluated on qwen3:8b; their call rate on
qwen3:4b is not yet measured. Auto does not retry a turn that made no tool call.

## Effort

Five steps. Each changes what the turn does (`infrastructure/chat-effort.ts`):

| Effort   | Thinking | Model calls | Number check |
| -------- | -------- | ----------- | ------------ |
| Quick    | off      | 4           | no           |
| Balanced | off      | 8           | no           |
| Thorough | on       | 8           | no           |
| Deep     | on       | 12          | no           |
| Ultra    | on       | 12          | yes          |

Balanced is the default and is the turn exactly as it ran before effort existed. A new
chat starts at Balanced; a saved thread reopens at the effort its last turn ran at, read
from that turn's response documents (#379).

- **Model calls** is the step limit of one turn (`runTwinTurn`). The last call has no
  tools, so a model still looking things up writes its answer from what it has.
- **Thinking** is Ollama's `think` flag. TwinLLM sets it only on Ollama and only for a
  model whose tags list the `thinking` capability (`thinking: true` on the catalog row);
  qwen3:4b does, the fine-tunes do not. A model without it runs with thinking off and
  the answer says "this model has no thinking mode". On another provider TwinLLM sets
  nothing either way and the answer says "thinking left to the provider". Effort adds no
  prompt text and no tool, so the context budget (`bun run prompt:size`) holds at every
  step; thinking does use part of the model's context while it runs.
- **Number check** (Ultra): see below.

The chat request carries `effort` (`/api/chat` and `/api/chat/incognito`; left out,
Balanced; anything not one of the five is refused like any malformed body). After every
other check and before the model is called, the turn writes a `chat.effort` audit row:
the model id and the step asked for, and what it became (thinking, model calls, number
check). No prompt text. If that write fails the model is not called. Like the skill and UI
context rows it reads nothing, so it is left out of the document's `tool_calls`. The
response document records `effort` ([response-schema.md](response-schema.md)).

## The number check

At Ultra a second pass runs on the finished answer before it is stored
(`features/chat/run-number-review.ts`). The reviewer, "Number check (research)", is a
fixed role on the same model the answer used, with no tools and thinking at the model's
default. It is given:

- the answer's numbers, found by the same matcher as the answer's number links
  (`answerNumbers`: dates and the counts 0 to 10 left out), at most 30, each with a little
  of the sentence around it. Only the Answer section is read (the whole reply when it has
  no sections), since Reasoning and Uncertainty often repeat its numbers, and a value
  written more than once is listed once, at its first place, so it gets one verdict
  (#379);
- the turn's tool results as JSON, cut at 12,000 characters with a note;
- the Answer section.

It replies with one line per number, `supported` or `unsupported: <reason>`. A number it
skips stays `unchecked`. Each number also keeps what the deterministic matcher found
(`matched`), so where the two disagree the step says so instead of letting the
reviewer's word stand alone. The reviewer is a model and can be wrong; the check
describes the answer's relation to its own tool results and says nothing about a person.

An answer without numbers calls no model. A call that fails or takes over two minutes
gives a review marked `failed`, with every number unchecked; the answer itself is
stored as usual. The request is recorded in the disclosure ledger with the purpose
"number check" and the categories answers and tool results: no system prompt, wearable
summary or twin note is sent.

While the check runs, the stream carries a `data-number-review` part so the answer's step
list can show it as the step in progress; the result comes with the response document
as `number_review`.

## The prompt bar

Under the text box, from left to right (`features/arena/prompt-bar.tsx`):

- **Sources** (the `@` button, or `@` and a word in the text): the sources this person
  can point a question at here (`prompt-sources.ts`): linked Oura, Whoop and Google
  Health; imported data and the genome when their policies allow this server's chat to
  read them; PubMed and Ensembl when the person switched them on (never in local-only
  mode or an incognito chat); and "Import a file", which opens Customize · Data.
  Picking a source writes `@Name` into the question. A mention is part of the question
  text: it does not switch a tool on or off, and every permit applies as it would
  without it.
- **Mode** (`mode-menu.tsx`): Auto, Manual or Compare, and for the latter two the
  specialists and models as checkboxes. A box that would break the mode's rule is
  disabled and the line under the lists says why. In an incognito chat the models that
  do not run on this machine stay in the lists, greyed out with the reason.
- **Effort** (`effort-menu.tsx`): a slider over the five steps with what the chosen
  step does. At Ultra the step name and the box take a faint tint (`--effort-ultra` in
  `globals.css`, light and dark); nothing moves.
- **Linked wearables** as before, with their disconnect buttons.
- **Send**, which becomes **Stop** while answers stream into this tab. Stop closes this
  tab's streams and marks those answers "You stopped this answer". The server is not
  told: in a saved thread it still finishes and stores the answer, and a reload shows
  it. Enter in the text box still sends.

`/` still opens the command palette with the skills, and the hint under the bar still
says when a prompt goes with a skill, that an incognito chat runs on local models only,
and when a thread's models are no longer offered; otherwise it gives the mode's line or
what the mode is missing. There is no microphone: TwinLLM has no dictation path.

An answer says which effort it ran at when that was not Balanced ("Ultra effort:
thinking on, up to 12 model calls, numbers checked."), and an Ultra answer's step list
ends with the number check: "Number check: 1 of 3 numbers flagged", with a line per
number when opened.
