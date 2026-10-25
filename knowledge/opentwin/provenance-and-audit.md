# Title: Provenance and audit

Where each kind of data in TwinLLM comes from, what the audit log records, and how
synthetic and personal mode differ. CC BY 4.0, Open Science Foundation. See LICENSE.md.

# Section: Where each kind of data comes from

TwinLLM answers from up to six kinds of input, and each is cited differently:

- Wearable snapshots (Oura, Whoop, Google Health): cited by metric key.
- BodyLoop body scans: cited by `vitronic.` metric key.
- The synthetic Synthea warehouse: read through the analytics tools, cited by tool call.
- Population figures from IHME GBD: cited as a population source.
- Published clinical guidelines: cited as guideline references.
- OpenTwin knowledge notes (these files): cited as OpenTwin knowledge.

Only the first three can count as data about a person. Population figures, guideline
passages and knowledge notes are reference material and never make an answer
"sufficient data".

# Section: Wearable snapshots

Oura, Whoop and Google Health connect through OAuth. A sync pulls a date window (14
days by default, at most 90) and stores a snapshot: a summary with metric keys and a
short narrative. Tokens are encrypted at rest. Chat reads only the summary narrative
and its keys, on the server. Wearable values are never written to the warehouse, never
sent to the GBD connector and never logged.

# Section: BodyLoop body scans

BodyLoop (Vitronic) is a body-scanner connector that uses a per-user API token instead
of OAuth. It supplies body measurements (heights, distances, circumferences, angles and
body properties) and an avatar file. The API sends SI units (metres, radians); TwinLLM
stores the payload as received and converts to centimetres and degrees only for display
and chat.

# Section: Synthetic Synthea cohort

The warehouse holds only synthetic patients generated with Synthea, an open-source
generator of realistic but fictional health records. The local cohort
`synthea-v4-seed42` uses Synthea v4.0.0, seed 42, 30 people aged 40–75 (35 records,
because Synthea also exports deceased patients). Every subject is marked synthetic, and
the database refuses rows from any other source. These rows describe no real person.

# Section: Population figures and guidelines

- Population figures come from the IHME Global Burden of Disease study (GBD 2021)
  through an optional connector. They describe populations, not this person. The
  connector receives only fixed fields (cause, measure, location, age, sex, year),
  never wearable values.
- Guideline passages come from published clinical guidelines stored locally. Only
  guidelines with an open licence (CC BY-NC or CC BY-NC-ND) are stored in full; the
  others are cited by title and DOI only.
- OpenTwin knowledge notes are written by the Open Science Foundation and published
  under CC BY 4.0.

# Section: What the audit log records

Every tool call is written to the audit log (`audit_events`) before its result reaches
the model, including calls that fail or are refused. Each row stores the time, the
actor, the chat turn, the subject reference (or none), the tool name, a sha256 hash of
the arguments, a sha256 hash of the result and the number of rows read. It never stores
observation values or wearable data; a failed call stores a short error marker, not the
error text.

The rows form a hash chain: each row's hash covers the previous row's hash plus its own
content, starting from 64 zeros. Changing or deleting a past row breaks the chain, and
`verifyChain()` reports the first broken row.

# Section: Synthetic and personal mode

`DATA_MODE` is either `synthetic` or `personal`.

- Synthetic mode: the model answers from the synthetic Synthea cohort. The chat reads no
  wearable snapshot. Every provider may be used, including OpenRouter and a rented
  remote GPU.
- Personal mode: the chat may read the person's own wearable snapshots. The warehouse
  scope is empty. Only providers that keep data in Switzerland or on this machine are
  allowed (Infomaniak, local Ollama). OpenRouter and the remote GPU are refused with
  `PROVIDER_NOT_PERMITTED_FOR_DATA_MODE`, and so is any request that carries wearable
  context.
