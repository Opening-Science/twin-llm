# Privacy design: unlock, encryption, hardening, consent, ledger, anchor

This document settles the decisions behind six issues so each can be built as its own
pull request: #144 harden local storage, #142 local unlock, #141 encryption at rest, #145
learning consent, #140 disclosure ledger and #300 an external anchor for the audit chain.
Nothing here is built yet. Where this document and the code differ, the code is what runs;
update this document when a pull request changes a decision.

TwinLLM is research software for one person on their own Linux or macOS machine. The design
keeps to that: one owner, one Postgres, one Next.js server on loopback, no cloud service of
our own. Research use only; nothing here is about anyone's health.

Related: [personal-data.md](personal-data.md) (imports), [providers.md](providers.md) (what
leaves the host), [lab.md](lab.md) (self-checks), [twin-notes.md](twin-notes.md),
[genome.md](genome.md), [storage.md](storage.md).

## 1. Threat model

### What we protect

| Asset                    | Where it is today                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal data at rest    | Postgres tables: wearable snapshots, BodyLoop scans and mesh files, genome reports, imported datasets and variants, chat threads, twin notes               |
| Personal data in use     | The Next.js server's memory while it answers a request; the browser tab; Ollama's memory during a turn                                                     |
| Personal data in transit | To Exoscale under the consented pilot only; OAuth and download requests to Oura, Whoop and Google; the BodyLoop scanner on the local network; export files |
| The record of access     | The audit chain (`audit_events`), which says what was read and when                                                                                        |

### From whom

| Adversary                                       | What they can do today                                                                                                                   | What this design changes                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Another OS user on the same machine             | Connect to Postgres on 127.0.0.1 with a default password, or to the app on 127.0.0.1:3000, which has sign-in off                         | #144 closes the database to them. #142 closes the app to them with an unlock cookie. #141 means a copied table holds ciphertext.             |
| Another program running as the owner            | Read `.env.local`, connect to Postgres, call the app on loopback, read files                                                             | While locked: it gets ciphertext only, because no key is on disk or in memory. While unlocked: out of reach of this design (see below).      |
| A stolen or discarded disk, or a stray backup   | Read every table and file                                                                                                                | #141: personal columns and mesh files are ciphertext; the key needs the passphrase. Full-disk encryption (FileVault, LUKS) is still advised. |
| A hosted provider (Exoscale pilot, vendor APIs) | Read what we send                                                                                                                        | #140 records each disclosure per recipient, with which values left. Policy (`permitProviderForRequest`) is unchanged and still decides.      |
| A curious maintainer                            | Nothing on a local install: there is no telemetry in local-only mode. On the Exoscale pilot, whoever runs the instance could read memory | #140 shows the person exactly what the pilot received. #145 means no maintainer pipeline may learn from personal rows without consent.       |
| Our own logs                                    | Server logs hold error names only by rule; Postgres or Ollama logs could hold text if misconfigured                                      | #144 adds a doctor check of Postgres logging settings. Encrypted columns mean a logged statement holds ciphertext.                           |
| Someone with write access to the database       | Edit, truncate or rebuild the audit chain without a trace                                                                                | #300 signs the chain head with a key outside the database, so truncation and rebuild show up at the next check.                              |

### Out of scope

- A compromised operating system, kernel or hypervisor. It can read any memory.
- A malicious local administrator (root). Root can read the server's memory, replace the
  code, or read the anchor key.
- A program running as the owner while the vault is unlocked. It can read the server's
  memory (where `ptrace` is allowed), or call the app with the browser's cookie. Full
  isolation needs OS sandboxing or a trusted execution environment; this design says so in
  the Lab and in `docs/providers.md`.
- What a vendor does with data that already sits in its cloud. Wearable data starts there.
- Side channels such as timing, row counts and dates. Section 2.3 lists which metadata
  stays readable on purpose.

The Lab page keeps its rule: every card is this machine reporting on itself, not remote
attestation. The #257 review lessons apply to every new card here: the command on the
card must repeat the check, a check that cannot run says Unknown and never OK, and an empty
table is not OK.

## 2. Decisions per issue

Shared names used below:

- **State directory.** `TWINLLM_STATE_DIR`, default `$XDG_DATA_HOME/twin-llm` (falling back
  to `~/.local/share/twin-llm`) on Linux and `~/Library/Application Support/TwinLLM` on
  macOS. Mode `0700`. Outside the repository, so a `git clean` or a copied checkout never
  carries it. It holds the anchor key and anchors, migration backups and, in the
  recommended setup, the Postgres cluster.
- **Vault.** The per-user key material of #142 and #141.
- **Synthetic installs.** With `DATA_MODE=synthetic` there is no vault, no unlock and no
  consent screen. Synthetic rows stay plaintext. The hardening checks of #144 and the
  anchor of #300 still apply.

### 2.1 #144 Harden local storage against other programs

**Decision.** Personal mode runs against a Postgres that only the owner's OS user can
reach, with owner-only files, a server umask of `077`, and a startup check that refuses to
start when any of it is wider. The recommended setup is a Postgres cluster owned by the
person, in the state directory, with no TCP listener at all.

**Design.**

- **Recommended: owner cluster.** `bun run setup:local -- --owner-cluster` runs
  `initdb -D $TWINLLM_STATE_DIR/pg --auth-local=scram-sha-256 --auth-host=reject` with a
  per-install password (32 random bytes, base64url) and sets `listen_addresses = ''`,
  `unix_socket_directories = '$TWINLLM_STATE_DIR/pg-socket'` and
  `unix_socket_permissions = 0700`. Only the owner's user can open the socket, and the
  password is still required. `DATABASE_URL` uses the socket
  (`postgresql://twinllm@/twin_llm?host=<socket dir>`), which `@prisma/adapter-pg` supports.
  pgvector must be installed for that Postgres version, as today.
- **Accepted: shared server.** A Homebrew, apt or Docker Postgres is accepted with
  conditions: `listen_addresses` is loopback only, the app connects as its own role
  `twinllm` that owns only the TwinLLM database and is not a superuser, and the role has a
  per-install password stored with `scram-sha-256`. Setup prints the exact `pg_hba.conf`
  lines; it never edits system files. Homebrew's default `trust` lines and Docker's
  `POSTGRES_PASSWORD=postgres` from `docs/guidelines.md` fail the check below.
- **Files.** `process.umask(0o077)` in `instrumentation.ts` before anything is written.
  The state directory, `VITRONIC_DATA_DIR`, `ANATOMY_DATA_DIR` (no personal data, checked
  for consistency only) and `.sbom/` are created `0700`. `.env.local` must be `0600`,
  because it holds the database password and OAuth secrets.
- **Startup check** (`infrastructure/storage-hardening.ts`, a pure function over `stat`
  results and the parsed URL, called from `serverEnv()`'s boot path). With
  `DATA_MODE=personal` the server refuses to start, with a named error, when:
  `.env.local` is readable by group or others; the state directory or
  `VITRONIC_DATA_DIR` is wider than `0700`; `DATABASE_URL` names a host that is not
  loopback or a socket path; `DATABASE_URL` has no password on a TCP host. In synthetic mode
  the same findings are warnings.
- **Doctor and Lab.** `bun run doctor` adds the checks it can only make with a connection:
  a connection to the same database without a password must be refused (this catches
  `trust`); `SHOW listen_addresses` must be loopback or empty; the app's role must not be a
  superuser; `log_statement` must be `none` or `ddl`; `log_min_duration_statement` must be
  off. A new Lab card, "Local storage", shows the same findings with names and modes only,
  and a command that repeats them (`stat -c '%a %n'` on Linux, `stat -f '%Lp %N'` on macOS,
  `psql -w` without a password).

**What the UI shows.** The Lab card. A boot failure names the file or setting and the fix,
never a path under the home directory in full (the card writes `$TWINLLM_STATE_DIR`).

**Failure behaviour.** Fail closed in personal mode: the server does not start. Fail open
with a warning in synthetic mode, because synthetic rows are public by design. A check that
cannot run (no permission to `stat`) is a refusal in personal mode and Unknown on the card.

**What remains, stated in the docs.** A program running as the owner can still read
`.env.local` and open the socket. #142 and #141 reduce what it gets while locked. Nothing
here stops root.

**Tests.** The pure check over table-driven `stat` results and URLs (loopback names,
`localhost.example.com`, socket paths, missing password). The doctor's passwordless probe
against a throwaway cluster made in a temporary directory in CI. A test that the umask is
set before the first write.

**Effort.** About 3 days: check and boot wiring 1, setup and doctor 1, Lab card and docs 1.

### 2.2 #142 Local unlock before personal data can be read

**Decision.** In personal mode each user sets a passphrase. It derives a key with
Argon2id. That key unwraps the user's data key, which lives only in the server's memory.
Every personal read needs the data key and an unlock cookie. The vault locks itself after
15 minutes without a personal request, on a lock button, and on every restart.

**Why Argon2id from `node:crypto`.** Node 24.7 added `crypto.argon2` and Bun implements the
same call; on this repository's toolchain both give the same bytes for the same inputs, so
the server (Node) and the CLIs (Bun) share one function with no new dependency. Argon2id is
memory-hard and is RFC 9106's recommendation for passwords. The Node API is still marked
experimental, so the vault stores the KDF's name and parameters with each wrapped key, and
`scrypt` (`N = 2^17, r = 8, p = 1`, also in `node:crypto`) is the documented fallback if
the API changes. No password-hashing package is added.

**Design.**

- **Keys.**
  - Passphrase: at least 12 characters. The setup screen says plainly that there is no way
    to read the data without it or the recovery code.
  - KEK (key-encryption key) = Argon2id(passphrase, salt 16 random bytes, memory 64 MiB,
    3 passes, parallelism 1, 32 bytes). About 120 ms on the maintainers' machine; the
    parameters are stored, so they can be raised later.
  - DEK (data key) = 32 random bytes per user. Stored only wrapped: AES-256-GCM under the
    KEK, with the user id and key id as additional data.
  - Recovery code: 20 random bytes shown once as base32 groups. It wraps the same DEK
    under its own Argon2id key. Using it forces a new passphrase.
  - Subkeys from the DEK with HKDF-SHA256: `field` for #141, `index` for blind indexes
    (#141), `ledger` for payload fingerprints (#140).
- **Where keys live.** New table `vault_keys`: user id, key id, status (`active`,
  `retiring`, `retired`), wrapped DEK under the passphrase, wrapped DEK under the recovery
  code, KDF name and parameters, salts, created and retired times. Nothing in it is usable
  without the passphrase or the code. Keeping it in the database keeps every backup
  consistent with its key. The unwrapped DEK and subkeys are `KeyObject`s in a module-level
  map (`infrastructure/vault-session.ts`): user id to keys, unlock time, last use and the
  hash of the unlock token. They are never written to disk, logs, Prisma, the audit chain
  or a response.
- **Unlock flow.** `POST /api/vault/unlock` with the passphrase in the JSON body (loopback
  only, same Host and cross-site checks as today). The server derives the KEK, unwraps,
  stores the keys in memory, and sets a cookie `twinllm_unlock` holding 32 random bytes:
  HttpOnly, SameSite=Strict, Path=/, Secure where the browser allows it on localhost. The
  server keeps only its SHA-256. The passphrase variable is dropped at once; the body is
  never logged.
- **Gate.** `requireUnlocked(userId, request)` in `infrastructure/vault-gate.ts` returns the
  keys or a typed `PERSONAL_DATA_LOCKED` refusal (HTTP 423, a plain sentence: "Your data is
  locked. Unlock it to continue."). Every route in the `tests/personal-reads` table calls
  it before reading. The chat route calls it once per turn and passes the keys to the tool
  ports; a personal tool with no keys refuses. The MCP server is a separate process with no
  vault, so it refuses every personal tool with the same code. Before #141 lands the gate
  is a check; after it, it is structural, because a store cannot decrypt without the keys.
- **Lock.** `POST /api/vault/lock` (a button in the header), idle lock after
  `VAULT_IDLE_LOCK_MINUTES` (default 15, allowed 1 to 240) checked on each request and by a
  one-minute timer, and process exit. Locking deletes the map entry; the cookie becomes
  useless.
- **Brute force.** Argon2id cost, plus a per-user in-memory delay that doubles after each
  wrong passphrase from 1 s up to 60 s. Offline guessing against a stolen disk is limited
  only by the KDF and the passphrase's strength; the docs say so.
- **Passphrase change and recovery.** Rewrap the DEK; no data is rewritten.
- **Writes while locked.** A wearable sync or an import needs the field key, so it is
  refused while locked with the same code. Syncs are started by the person, so this costs
  nothing today. OAuth callbacks still store tokens, which keep their own env keys (see
  2.3).
- **Multiple users.** With sign-in on, each user has their own vault row and passphrase;
  unlocking one user never unlocks another.

**What the UI shows.** A first-run screen in personal mode: set a passphrase, then the
recovery code with "I have saved it" before continuing. A lock icon and state in the
header. Personal pages show an unlock form instead of their content while locked; synthetic
content and the Lab stay available. The sidebar shows "Locked" in place of personal thread
titles.

**Audit rows** (ids and outcomes only): `vault.setup`, `vault.unlock` (ok or refused, with
the failure count), `vault.lock` (manual or idle), `vault.passphrase_change`,
`vault.recovery_used`. A restart leaves the vault locked and writes nothing.

**Failure behaviour.** Fail closed: no keys, no personal read or write. If the unlock audit
row cannot be written, the unlock is undone. A lost passphrase and a lost recovery code
mean the encrypted data cannot be read; the person can still delete it.

**Tests.** The `tests/personal-reads` table gains a column, and a test asserts that every
listed route answers 423 when locked and with a missing or wrong cookie. Pure tests for
key wrapping, wrong passphrase, stored parameters, recovery, rewrap, idle timing (with an
injected clock) and the backoff. A chat turn while locked offers no personal tool.

**Effort.** About 5 days: crypto and session 1, routes and gate across routes and tools 2,
screens 1, tests and docs 1.

### 2.3 #141 Encrypt personal data at rest

**Decision.** Field-level envelope encryption with AES-256-GCM under the user's data key
from #142, for the personal columns listed below. Columns that are only needed to find rows
use a keyed blind index or stay plaintext, as listed. The issue's "OS keyring, env-file
fallback" is replaced by the passphrase: an env-file key would sit next to the database
and protect nothing against the threats above. Encryption uses `node:crypto`
`createCipheriv`, as `features/*/token-crypto.ts` already does, because it is synchronous
and fast for many small fields; Web Crypto's `subtle` is async per call and slower for
200,000 rows.

**Design.**

- **Format.** A text column holds `tlenc1.<keyId>.<iv>.<ciphertext+tag>` (base64url, 12
  byte random IV, 16 byte tag). The additional data is `<table>.<column>.<row id>`, so a
  value cannot be moved to another row or column. Stores set row ids themselves before
  encrypting. A `Json` or numeric column becomes a text column holding the encrypted
  canonical JSON or number. One pure module, `infrastructure/field-crypto.ts`, encrypts,
  decrypts and checks the prefix.
- **Blind index.** `HMAC-SHA256(index key, <table>.<column>.<value>)`, first 16 bytes, hex.
  It allows lookups by equality without showing the value. It reveals which rows share a
  value, not what the value is.
- **Columns.**

| Table                                        | Encrypted                                                               | Blind index                                    | Stays plaintext, and why                                             |
| -------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `threads`                                    | `title`                                                                 |                                                | ids, dates                                                           |
| `turns`                                      | `prompt`                                                                |                                                | ids, dates                                                           |
| `model_responses`                            | `text`, `reasoningText`, `attribution`, `responseDocument`, `toolParts` |                                                | model id and name, status, timings, token counts                     |
| `thread_search_embeddings`                   | the vector, as encrypted bytes; search runs in memory after unlock      |                                                | ids, kind                                                            |
| `oura_`, `whoop_`, `google_health_snapshots` | `summary`, `fhirBundle`                                                 |                                                | `startDate`, `endDate`, `syncedAt` (to pick the newest window)       |
| `vitronic_snapshots`                         | `summary`, `markers`, `measures`, `fhirBundle`; the mesh file on disk   |                                                | ids, `glbSha256` (of the plaintext, for the pin check)               |
| `vitronic_subjects`                          | `label`, `consentNote`                                                  |                                                | consent time and actor                                               |
| `genome_reports` (user rows)                 | `rows`, `report`                                                        |                                                | `app`, `arkBuild`, dates; synthetic subjects' reports stay plaintext |
| `personal_datasets`                          | `name`, `sourceFileName`, `firstAt`, `lastAt`                           | `sha256` becomes an HMAC of the file's SHA-256 | `kind`, `byteSize`, `rowCount`, `status`                             |
| `personal_observations`                      | `codeSystem`, `code`, `display`, `value`, `unit`, `sourceRef`, `note`   | `code`                                         | `effectiveAt` (range queries), `effectivePrecision`, `unitUcum`      |
| `personal_clinical_records`                  | `codeSystem`, `code`, `display`, `status`, `sourceRef`                  | `code`                                         | `resourceType`, `startAt`, `endAt`                                   |
| `personal_tables`, `_chunks`                 | `columns`, `rows`                                                       |                                                | counts, chunk index                                                  |
| `personal_variants`                          | `chrom`, `pos`, `variantId`, `ref`, `alt`, `genotype`, `filter`         | site (`chrom:pos`), `variantId`                | none of the content                                                  |
| `twin_notes`                                 | `title`, `topics`, `measures`, `openQuestions`                          |                                                | `dataMode`, `permit`, dates                                          |
| `onboarding_profiles`                        | `interest`                                                              |                                                | roles and steps (fixed choices)                                      |
| `disclosure_events` (#140)                   | `values`                                                                |                                                | recipient, categories, counts                                        |

- **Not encrypted, on purpose.** The synthetic warehouse, guidelines and knowledge chunks
  (public or synthetic). `audit_events` (hashes, ids and counts only; it must verify while
  locked). `user_skills` (instructions the person wrote, not records; listed so the choice
  is visible). OAuth and BodyLoop tokens keep their own AES-256-GCM env keys
  (`*_TOKEN_ENCRYPTION_KEY`); moving them under the vault is a later step, because an OAuth
  callback can arrive while locked.
- **Queries.** Tools that filter by code use the blind index and `effectiveAt`, then
  decrypt the matching rows and compute in memory. Ordering by value, text search inside a
  column and SQL aggregates over encrypted columns are gone; the current tools do not need
  them except `imported_trend`'s statistics, which move into TypeScript.
- **Thread search.** Personal installs keep embeddings encrypted and search a user's
  vectors in memory after unlock (a person's threads give thousands of vectors, not
  millions). Synthetic installs keep the pgvector HNSW index.
- **Rotation.** Each value names its key id, so old and new keys can be read side by
  side. A passphrase change rewraps only (2.2). Data key rotation runs in the app from
  Customize · Privacy while unlocked: new DEK `active`, old one `retiring`, rows rewritten
  in batches of 500 per transaction (resumable from the last id), blind indexes
  recomputed, then the old key `retired` once no row names it. Audited as `vault.rotate`
  with counts.
- **Doctor and Lab.** `bun run doctor` and a Lab card, "Encryption at rest", count rows per
  listed column that do not start with `tlenc1.`. Any count above zero in personal mode is
  Not OK, with the table and column names, never a value. The command is a `psql` query
  with the same `LIKE` test.

**What the UI shows.** The "Not encrypted at rest yet (#141)" line in Customize · Data
becomes "Encrypted on this machine with your passphrase." Customize · Privacy shows the
key id, its age and a Rotate button.

**Failure behaviour.** A value that fails to decrypt (wrong key, edited ciphertext) is an
error for that request, never a silent empty value, and is logged by error name only. A
write that cannot encrypt is not made. Rotation stops at the first failure and can resume.

**Tests.** Round trip per column type; tamper (one changed byte) fails; a value moved to
another row fails on its additional data; mixed key ids during rotation; rotation
resumption; blind index lookups; the doctor's plaintext count. Every store test runs with
an in-memory key from a fixed test passphrase. Fixtures stay synthetic and made up.

**Effort.** About 8 days: crypto and format 1, schema migration 1, stores and tools 3,
search 1, rotation 1, doctor, Lab and docs 1.

### 2.4 #145 Explicit consent before any learning from personal data

**Decision.** A consent record per user and scope, off by default, granted and withdrawn
only on Customize · Privacy, audited. Every learning pipeline asks one pure function before
it reads a row and refuses any row that is not synthetic unless a matching consent holds.
Making a twin note, searching threads or loading notes is the person's own use, not
learning, and needs no consent.

**Design.**

- **Table `learning_consents`.** User id; scope: `training` (fine-tuning sets),
  `answer-key` (evaluation keys), `evaluation` (scoring runs); sources, a list from
  `wearables`, `imports`, `genome`, `chat`, `notes`, `body-scans`; the exact sentence shown
  and its SHA-256; granted time; withdrawn time; the `seq` of the audit row that granted
  it. A row is never edited except to set the withdrawn time.
- **Gate.** `permitLearningUse({ scope, rows, consents, at })` in
  `infrastructure/learning-consent.ts`. A row is synthetic only when its subject is
  `is_synthetic` and its cohort is in `SYNTHETIC_COHORTS`. Refusal codes:
  `SOURCE_NOT_SYNTHETIC`, `LEARNING_CONSENT_MISSING`, `LEARNING_CONSENT_WITHDRAWN`,
  `LEARNING_CONSENT_SCOPE`, each with a plain sentence saying which source and why.
- **Where it runs.** `training:conversations`, `training:batches`, `training:split`,
  `eval`, `eval:answer-key*` and the Lab's training sample. Each checks at start and again
  before writing output, and writes the consent ids it relied on into its manifest, so a
  set made under a consent can be found after a withdrawal.
- **Scope of this step.** No pipeline reads personal rows today, and they would need an
  unlocked vault (#142) to do so. This step builds the record, the screen and the gate, and
  keeps the existing `DATA_MODE=synthetic` refusals. A pipeline that reads personal rows
  needs its own decision and must pass this gate.
- **Withdrawal.** Sets the withdrawn time and writes `learning.consent.withdraw`. Future
  runs refuse. The screen says plainly that a model already trained cannot unlearn, and
  lists the output sets whose manifests name the consent, so the person can delete them.

**What the UI shows.** Customize · Privacy, "Learning from your data": off by default, one
switch per scope with the sources it covers, the date granted, and Withdraw. It states that
de-identification does not replace consent.

**Failure behaviour.** Fail closed. A consent table that cannot be read counts as no
consent. A grant whose audit row cannot be written is not stored.

**Tests.** For each pipeline: a non-synthetic row is refused without consent, with a
withdrawn consent and with a consent of another scope; a synthetic row passes with no
consent; the manifest records the consent ids. Pure tests of the gate's table of cases.

**Effort.** About 3 days.

### 2.5 #140 Disclosure ledger

**Decision.** A separate hash-chained table, `disclosure_events`, with one entry per event
in which personal data leaves this machine or a device of the person's reaches it. It
reuses the audit chain's hashing and is written in the same transaction as the audit row
for the event, before the data is sent. The Lab and Customize · Privacy show running totals
per recipient.

**Design.**

- **Events and recipients.**

| Kind           | When                                                                                  | Recipient                    | What is recorded                                                          |
| -------------- | ------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `hosted-model` | A personal request to Exoscale under the consented pilot (chat, starters, `/compact`) | `exoscale` and the model id  | The values the prompt carried (see below), categories, payload size       |
| `vendor-sync`  | An Oura, Whoop or Google Health sync or token refresh                                 | The vendor                   | Request kind, the date window asked, no health values (none are uploaded) |
| `export-file`  | A thread export (`/api/threads/<id>/export`), and `/report` when built                | `export file`                | Format, the values in the file, categories, file size                     |
| `ark-release`  | A genome report released from the person's Ark into TwinLLM                           | `this machine, from the Ark` | App, row count; listed under "Received" rather than "Sent"                |

Ollama on loopback is not a recipient. Providers that the data-mode policy refuses never
get an entry, because nothing is sent.

- **Which values left.** Two sources, both recorded as references, never values: the keys
  the prompt builder injected (`oura.hrv_rmssd@2026-10-20`, an observation id), and the
  numbers the #112 matcher (the one that makes sourced numbers clickable) finds in the
  person's text and tool results that match a stored personal value. Each reference keeps
  its category (wearable, import, genome, scan, chat, note). The list is encrypted under
  the field key (#141).
- **Row.** `seq`, time, user id, kind, recipient, categories, count of values, payload
  bytes, an HMAC of the payload under the ledger key (so the person can match a copy they
  hold, and nobody can test guesses), the encrypted value list, the audit `seq` it pairs
  with, `prevHash`, `hash`. `packages/audit` gets a generic chain over a typed row so both
  chains share one hash and one verifier.
- **Order.** Ledger row and audit row in one transaction, then the send. If the
  transaction fails, nothing is sent. The existing `provider.personal_data_sent` row stays
  and is paired with the ledger row.

**What the UI shows.** Customize · Privacy, "What left this machine": one line per
recipient with first and last date, events and values by category, and a cumulative chart
over time; each event opens to its references (after unlock). A Lab card, "Disclosure
ledger", shows counts per recipient and whether the chain verifies, while locked too, with
`verify-cli --check --chain disclosures` as its command.

**Failure behaviour.** Fail closed: no ledger row, no send, no export download. A matcher
that fails records the injected keys and marks the event "values in free text not
checked" rather than counting zero.

**Tests.** One test per event kind with a fake sender that asserts the row exists before
the send; a failed write stops the send; chain verification over a seeded ledger and a
tampered one; the cumulative view as a pure function; the value list holds references and
never a number from the payload.

**Effort.** About 5 days.

### 2.6 #300 An external anchor for the audit chain head

**Decision.** A dedicated Ed25519 key, generated at setup and kept outside the repository
and the database, signs the head of the audit chain and of the disclosure ledger. It is
not the git signing key: Peter chose a key that does one job, so rotating or losing it
touches nothing else.

**Design.**

- **Key.** `bun run anchor:init` (also run by `setup:local`) calls
  `generateKeyPairSync("ed25519")` from `node:crypto` and writes
  `$TWINLLM_STATE_DIR/anchor/anchor-key.pem` (PKCS#8, mode `0600`) and `anchor-key.pub`,
  in a directory of mode `0700`. The key id is the SHA-256 of the public key, shown in the
  Lab. The private key is not encrypted with the vault passphrase, so anchors can be
  written while locked and in synthetic installs. Anyone who can read the key file as the
  owner can forge anchors; that is the stated limit.
- **Anchor.** One JSON line per anchor in `$TWINLLM_STATE_DIR/anchor/anchors.jsonl`
  (`0600`): `{ v: 1, chain, seq, hash, headTs, at, keyId, prev }` plus `sig`, an Ed25519
  signature over the canonical JSON without `sig`. `prev` is the SHA-256 of the line
  before, so a removed line in the middle shows. One line per chain (`audit`,
  `disclosures`).
- **When.** Every `AUDIT_ANCHOR_INTERVAL_MINUTES` (default 10) when a head moved, on clean
  shutdown (SIGTERM and SIGINT in `instrumentation.ts`), and at the end of
  `setup:local`. A failed write is logged by error name and retried at the next interval;
  it never blocks a request.
- **Verify.** Pure `checkAnchors(lines, publicKeys, chainRowAt)`: each signature holds
  under a known key; each line's `prev` matches; the newest anchor's `seq` exists in the
  chain with the same hash; the chain's head is at or after it. The Lab's "Audit chain"
  card adds "Latest anchor: seq N at <time>, signature OK, chain matches", and Not OK for a
  shorter chain (truncation), a different hash at that seq (rebuild), a bad signature or an
  unknown key. `verify-cli --check` reads the anchors file by default and takes
  `--anchors <path>`; `--no-anchors` keeps today's check.
- **Off the machine.** The file is still on the same disk. `bun run anchor:export` prints
  the newest line so the person can keep it somewhere else (a note, a USB stick, a commit
  in a private repository). The Lab card shows when the last export was made, if the
  person records it.
- **Rotation.** `bun run anchor:rotate` makes a new key and writes a rotation line, signed
  by the old key, that names the new public key; later lines use the new key. A lost or
  exposed key: `anchor:rotate --without-old-key` starts a new key with an unsigned
  rotation line, which the Lab shows as a break in continuity (Unknown up to that point),
  never as OK.

**Failure behaviour.** No key: the card says anchors are off and how to create one
(Unknown, not OK). An anchors file that cannot be read: Unknown. A verification failure:
Not OK with the reason, never a silent pass.

**Tests.** Sign and verify; truncation, rebuild, a removed middle line, a bad signature,
an unknown key, rotation with and without the old key, an empty chain. E1 in the P4 plan
reruns faults F3 and F4 and must now detect them.

**Effort.** About 3 days.

## 3. Order of work

| Step | Issue | Depends on                                         | Touches                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ----- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | #144  | none                                               | `infrastructure/env.ts` (new settings), new `infrastructure/storage-hardening.ts`, `instrumentation.ts`, `scripts/setup/{local,plan,doctor}.ts`, `features/lab/`, `docs/guidelines.md`, `docs/storage.md`, `docs/runbook.md`                                                                                                                                           |
| 2    | #142  | #144 (state dir, loopback)                         | `prisma/schema.prisma` (`vault_keys`), new `infrastructure/vault*.ts`, `app/api/vault/*`, every route in `tests/personal-reads/personal-reads.test.ts`, chat tool ports in `packages/query-tools/`, `scripts/mcp-server.ts`, header and first-run screens                                                                                                              |
| 3    | #141  | #142 (keys)                                        | Migration of the columns in 2.3, `infrastructure/personal-data-store.ts`, `genome-report-store.ts`, wearable snapshot stores in `features/{oura,whoop,google-health,vitronic}`, thread and turn persistence in `features/chat` and `features/threads`, `features/memory`, `features/search`, doctor, Lab                                                               |
| 4    | #145  | #142                                               | `learning_consents`, new `infrastructure/learning-consent.ts`, `scripts/training-data/*`, `scripts/evaluation/*`, Customize · Privacy                                                                                                                                                                                                                                  |
| 5    | #140  | #141 (value list encrypted)                        | `disclosure_events`, `packages/audit` (generic chain), `infrastructure/personal-data-audit.ts`, the chat and starter provider paths, `features/memory/compact-handler.ts`, `features/arena/thread-export-handler.ts`, `features/wearables/` syncs, `features/digital-twin/genome-run.ts`, the #112 matcher in `infrastructure/rich-text.tsx`, Lab, Customize · Privacy |
| 6    | #300  | #144 (state dir); covers #140's chain when present | new `packages/audit/anchor*.ts`, `verify-cli.ts` and its args, `features/lab/audit-chain-check.ts`, `instrumentation.ts`, setup scripts                                                                                                                                                                                                                                |

#300 needs only #144 and can run in parallel with steps 2 to 5; it then adds the ledger
chain as a second anchored chain. Customize · Privacy is created by #141 (key and rotation)
and grows with #145 and #140. Each step is its own pull request with its own CHANGELOG
entry and doc updates.

Total about 27 working days.

## 4. Migration of existing local data

- **Synthetic-only installs** (`DATA_MODE=synthetic`, no personal rows): nothing to
  migrate. The new migrations add tables and change column types on empty personal tables.
  #144's checks apply; #300 creates a key at the next `setup:local`.
- **Personal installs** migrate in place with `bun run vault:migrate`, with the app
  stopped:
  1. Check: the #144 startup check passes, and there is free space for a backup.
  2. Backup: `pg_dump` of the TwinLLM database to
     `$TWINLLM_STATE_DIR/backups/pre-encryption-<date>.dump` (mode `0600`), and a copy of
     `VITRONIC_DATA_DIR`. The command prints the path and the dump's SHA-256.
  3. Set the passphrase on the terminal (no echo) and show the recovery code; the person
     confirms they saved it.
  4. Add the new encrypted columns next to the old ones, encrypt rows in batches of 500
     per transaction (resumable), and check each batch by decrypting it and comparing with
     the source.
  5. Encrypt the mesh files, verify, then remove the plaintext copies.
  6. A second migration drops the plaintext columns only when the doctor's plaintext count
     is zero.
  7. The doctor warns while a pre-encryption backup exists, because it holds plaintext.
     The person decides when to delete it; the command prints how.
- **Undo.** Until step 6 the old columns are intact, so stopping and restoring is safe.
  After step 6 the backup is the only plaintext copy.
- **Tests.** The migration runs in CI on a throwaway database seeded with synthetic
  personal-shaped rows (made-up fixtures from `tests/fixtures/personal-import/`), with an
  interruption at a batch boundary and a resume.

## 5. Open questions for Peter

1. **OS keyring.** Should a later step offer "remember on this machine" (macOS Keychain,
   Linux Secret Service) instead of typing the passphrase? It is convenient, but the
   keyring opens for any program running as the owner after login, which undoes most of
   what locking gives. The default here is no.
2. **Idle lock.** Is 15 minutes right as the default?
3. **Anchors off the machine.** Is a manual `anchor:export` enough, or should anchors also
   go somewhere automatically, such as a commit to a private repository? Automatic would
   be a new outgoing channel, and would get its own ledger entry.
