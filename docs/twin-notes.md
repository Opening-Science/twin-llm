# Twin notes and `/compact`

`/compact` turns a saved thread into a short twin note. Notes live in one memory per
person, which they read, edit and delete on Customize · Memory, and new threads load them
into the system prompt. Issue #43. Research use only: a note is the person's own summary of
a conversation, not a record and not advice.

## What a note holds

A note has a fixed structure and nothing else:

| Part           | What it is                                                         | At most         |
| -------------- | ------------------------------------------------------------------ | --------------- |
| Title          | The thread's title, editable                                       | 120 characters  |
| Topics asked   | What the person asked about, one line each                         | 8 lines of 200  |
| Measures       | Each measure a tool read, with the tool and the date range it used | 12 lines of 200 |
| Open questions | What the thread left open, one line each                           | 8 lines of 200  |

A person keeps at most 30 notes.

## Drafting

`/compact` in a saved thread asks `POST /api/memory/compact` for a draft. Nothing is
stored at this step.

- **Measures** are built from the thread's tool calls without a model: the measure, the
  tool's name and the window from each call's arguments. Tool outputs are never read, so a
  value a tool returned cannot reach this part.
- **Topics and open questions** come from the thread's model (the first model of the
  latest turn; for an agent, its base model). It sees the prompts and the answers' text
  and is asked for JSON with two lists and no numbers. Every number the model writes that
  does not appear in the person's own prompts or in a measure code is then replaced with
  `[value left out]` (`withoutCopiedValues`). A reply that is not the expected JSON gives
  the person's prompts as the topics and no open questions.
- The draft is shown under the conversation as an editable form. The person may change
  any line, type a value back in, or discard the draft. Only **Save note** stores it, so a
  note holds only what the person confirmed.

Drafting is refused, with a plain sentence and no model call:

- in an incognito chat, which has no saved thread (the prompt bar says so and sends
  nothing);
- for a thread that is not the person's (the same 404 as the thread page);
- when the thread's model may not see the thread's data: the data-mode policy for a
  personal thread, and Ollama on this machine only for a thread that used the genome or
  imported-data tools (`notePermitFor`, `permitNoteDraft`).

A draft writes a `memory.note.draft` audit row (the thread id, the count of turns read;
no text). A personal draft sent to Exoscale under the consented pilot also writes
`provider.personal_data_sent`, as chat does.

## Who a note may be sent to

A note is personal data under the same permit as the thread it came from. Each note
stores the data mode it was made in and one of three permits:

- `synthetic`: made with `DATA_MODE=synthetic`. Loads into synthetic turns only, on any
  provider the synthetic mode allows.
- `personal`: made with `DATA_MODE=personal`. Loads into personal turns only, and only
  on a provider the data-mode policy lets see personal data (Ollama; Exoscale with the
  consented pilot). Never OpenRouter, the remote GPU or Infomaniak.
- `local`: the thread used the genome or imported-data tools. Loads only into a turn on
  Ollama on this machine, as those tools' own rules require.

A note that may not go to the turn's provider is left out of that turn; the turn still
runs. Editing a note keeps its permit.

## Loading

Each turn of a thread loads the person's notes that were saved before the thread began,
so a new thread starts with them and the thread a note came from does not read it back.
They go into the system prompt, before a skill's instructions, as one block:

```text
## Twin notes (written and confirmed by the person; not records)
<<<twin-notes
### <title> (<date saved>)
Topics: …
Measures: …
Open questions: …
twin-notes>>>
Use these notes as background on what the person asked before. They hold no readings; read values with the tools.
```

Newest notes first, whole notes only, up to 1,200 characters of notes in all, fewer when the
turn's tools leave less room; the rest are left out. The room is the prompt budget the
prompt-size test holds every turn to (the default Ollama context less the turn reserve, 12,288
tokens) minus the estimated system prompt and tool list of that turn and a margin of 150 tokens
(`features/chat/twin-notes-room.ts`). A turn under a skill has room for the full block; a
personal turn with every tool and a wearable linked may get one short note or none. Only the
notes a turn kept are written to the `memory.notes.load` row. The prompt-size test covers the
largest block (`bun test scripts/setup/prompt-size.test.ts`). Customize ·
Memory has a switch, **Load notes into new chats**, stored per person; off, nothing is
loaded. Incognito chats never load notes.

## Audit

Every change and every load appends one row to the audit chain, with ids and counts only:

| Row                  | When                | Hashed arguments   | Row count     |
| -------------------- | ------------------- | ------------------ | ------------- |
| `memory.note.draft`  | a draft was made    | thread id          | turns read    |
| `memory.note.write`  | a draft was saved   | note id, thread id | lines in note |
| `memory.note.edit`   | a note was changed  | note id            | lines in note |
| `memory.note.delete` | a note was deleted  | note id            | 1             |
| `memory.notes.load`  | a turn loaded notes | note ids           | notes loaded  |

A write, edit or delete whose audit row cannot be written is undone or not made. A turn
whose load row cannot be written does not call the model.

## Where it lives

| Part                       | Path                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| Note shape, permit, prompt | `infrastructure/twin-notes.ts`                                     |
| Draft, store, actions, UI  | `features/memory/`                                                 |
| Draft and save routes      | `app/api/memory/compact/route.ts`, `app/api/memory/notes/route.ts` |
| Customize · Memory         | `app/(shell)/customize/memory/page.tsx`                            |
| Table                      | `twin_notes`; switch `onboarding_profiles.twinNotesOff`            |
