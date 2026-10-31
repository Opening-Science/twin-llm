# Privacy design: unlock, encryption, hardening, consent, ledger, anchor

This document settles the decisions behind six issues so each can be built as its own
pull request: #144 harden local storage, #142 local unlock, #141 encryption at rest, #145
learning consent, #140 disclosure ledger and #300 an external anchor for the audit chain.
Status: #144, #142 and #141 are built (sections 2.1, 2.2 and 2.3 describe what shipped);
#145, #140 and #300 are not built yet. Where this document and the code differ, the code is what runs; update
this document when a pull request changes a decision.

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

**Design** (as built).

- **Recommended: owner cluster.** `bun run setup:local -- --owner-cluster`
  (`scripts/setup/owner-cluster.ts`) runs `initdb -D $TWINLLM_STATE_DIR/pg
--auth-local=scram-sha-256 --auth-host=reject` with a setup-only superuser
  `twinllm_admin`, appends `listen_addresses = ''`,
  `unix_socket_directories = '$TWINLLM_STATE_DIR/pg-socket'`,
  `unix_socket_permissions = 0700`, `log_statement = 'none'` and
  `log_min_duration_statement = -1` to its `postgresql.conf`, starts it with `pg_ctl`, and
  creates the role `twinllm` (login, not a superuser, no CREATEDB, CREATEROLE or
  REPLICATION) owning the database `twin_llm`, with `CONNECT` revoked from `PUBLIC`. The
  admin adds pgvector, which is not a trusted extension. Both passwords are 32 random bytes
  (base64url) in `$TWINLLM_STATE_DIR/owner-cluster.env` (mode `0600`), never printed. Then
  `prisma migrate deploy` runs against the new cluster. Only the owner's user can open the
  socket, and the password is still required. `DATABASE_URL` uses the socket:
  `postgresql://twinllm:<password>@localhost/twin_llm?host=<socket dir>`. The `localhost`
  is there because Prisma's migrate refuses an empty host; the `host` parameter wins, so
  node-postgres and Prisma both connect through the socket. Setup never edits an existing
  `.env.local`; it prints a command that copies the `DATABASE_URL` line across without
  printing it. initdb and pg_ctl come from `TWINLLM_PG_BIN`, else `pg_config --bindir`, else
  `PATH`. It works only inside `$TWINLLM_STATE_DIR/pg` and stops if that folder holds a
  cluster it did not make, so no other cluster is touched. Re-running starts a stopped
  cluster and adds what is missing. pgvector must be installed for that Postgres version,
  as today.
- **Accepted: shared server.** A Homebrew, apt or Docker Postgres is accepted with
  conditions: `listen_addresses` is loopback only, the app connects as its own role
  `twinllm` that owns only the TwinLLM database and is not a superuser, and the role has a
  per-install password stored with `scram-sha-256`. The runbook ("Owner-only Postgres")
  gives the SQL and the `pg_hba.conf` lines; setup never edits system files. Homebrew's
  default `trust` lines and Docker's `POSTGRES_PASSWORD=postgres` from `docs/guidelines.md`
  fail the checks below.
- **Files.** `process.umask(0o077)` is the first step of `instrumentation.ts`
  (`infrastructure/startup-order.ts`), before the environment is read and before anything is
  written. BodyLoop mesh files are also written with explicit modes (`0700` folders, `0600`
  files) in `packages/vitronic/glb.ts`. Personal mode creates the state directory `0700`
  when it is missing. `.env.local` (and `.env` when present) must be `0600`, because it holds
  the database password and OAuth secrets. Imports and uploads are not written to disk; their
  rows go to Postgres. `ANATOMY_DATA_DIR` and `.sbom/` hold no personal data and are not
  checked (a change from the first draft of this section).
- **Startup check** (`infrastructure/storage-hardening.ts`, pure, over `stat` results, the
  parsed URL and one query; run by `infrastructure/storage-scan.ts` after `serverEnv()`).
  With `DATA_MODE=personal` the server refuses to start, with `StorageNotOwnerOnlyError`,
  when: the state directory, `VITRONIC_DATA_DIR` or anything inside it is wider than
  `0700`/`0600` or owned by another user; `.env.local` is readable by group or others;
  `DATABASE_URL` names a host that is not loopback (`localhost`, `127.0.0.0/8`, `::1`;
  `localhost.example.com` is not) or a socket outside the state directory; the socket folder
  is wider than `0700`; `DATABASE_URL` has no password on a TCP host; the app's role is a
  superuser; or `listen_addresses` is not empty with a socket, or not loopback with TCP. The
  last two need a connection, so they moved from the doctor into the startup check. A check
  that cannot run (no permission to `stat`, the database does not answer) is a refusal. In
  synthetic mode the same findings are one warning line and the server starts. Next.js does
  not exit when `register` throws: it logs the message and answers every request with 500,
  as it already did for an invalid environment.
- **Doctor and Lab.** `bun run doctor` has a "Local storage" section, and
  `bun run lab:storage` prints the same lines (exit 0 OK, 1 Not OK, 2 Unknown). Both add the
  checks the server does not make at startup: a connection to the same database with an
  empty password must be refused (this catches `trust`), and `log_statement` must be `none`
  or `ddl` and `log_min_duration_statement` off. The Lab card, "Local storage", shows every
  finding except the passwordless one, which needs a second connection, as a table of item,
  found, needed, result and fix, with names and modes only. Its command is
  `bun run lab:storage` followed by the same checks by hand (`stat -c '%a'` on Linux,
  `stat -f '%Lp'` on macOS, `find -perm /077`, a `psql` query for the role and
  `listen_addresses`, `psql -w` without the password).

**What the UI shows.** The Lab card. A boot failure names the file or setting, its mode and
the command that fixes it, never a password or a path under the home directory in full: the
card writes `$TWINLLM_STATE_DIR`, and a fix writes `$HOME/...` or a path relative to the
repository.

**Failure behaviour.** Fail closed in personal mode: the server does not start. Fail open
with a warning in synthetic mode, because synthetic rows are public by design. A check that
cannot run is a refusal in personal mode and Unknown on the card.

**What remains, stated in the docs.** A program running as the owner can still read
`.env.local`, the passwords file and open the socket. #142 and #141 reduce what it gets
while locked. Nothing here stops root. Full isolation needs OS sandboxing or a trusted
execution environment.

**Tests.** The pure checks over table-driven `stat` results and URLs (loopback names,
`localhost.example.com`, socket paths, `%2F` hosts, missing password), the role and
`listen_addresses` rules, the refusal wording (no secret, no home path), the scan over fake
ports, the walk over a temporary folder, the startup order (umask first) and the mesh file
modes. The doctor's passwordless probe and a personal-mode start were run by hand against a
throwaway cluster ([runbook.md](runbook.md#owner-only-postgres)); there is no CI job with a
Postgres yet.

**Effort.** About 3 days: check and boot wiring 1, setup and doctor 1, Lab card and docs 1.

### 2.2 #142 Local unlock before personal data can be read

**Decision.** In personal mode each user sets a passphrase. It derives a key with
Argon2id. That key unwraps the user's data key, which lives only in the server's memory.
Every personal read needs the data key and an unlock cookie. The vault locks itself after
15 minutes without a personal request (Peter's decided default), on a lock button, and on
every restart. No OS keyring (question 1 in section 5: no).

**Why Argon2id from `node:crypto`.** Node 24.7 added `crypto.argon2` and Bun implements the
same call; on this repository's toolchain both give the same bytes for the same inputs, so
the server (Node) and the CLIs (Bun) share one function with no new dependency. Argon2id is
memory-hard and is RFC 9106's recommendation for passwords. The Node API is still marked
experimental, so the vault stores the KDF's name and parameters with each wrapped key, and
`scrypt` (`N = 2^17, r = 8, p = 1`, also in `node:crypto`) is the fallback, used when a
runtime has no `crypto.argon2`. No password-hashing package is added. The tests check
Argon2id against the RFC 9106 vector and scrypt against the RFC 7914 vector.

**Design** (as built).

- **Keys** (`infrastructure/vault-crypto.ts`, pure).
  - Passphrase: at least 12 characters (counted after NFC normalisation). The setup
    screen says plainly that there is no way to read the data without it or the recovery
    code.
  - KEK (key-encryption key) = Argon2id(passphrase, salt 16 random bytes, memory 64 MiB,
    3 passes, parallelism 1, 32 bytes). About 120 ms on the maintainers' machine; the
    parameters are stored, so they can be raised later. Stored parameters above fixed
    limits (4 GiB, 64 passes) are refused before any work, so an edited file cannot
    exhaust memory.
  - DEK (data key) = 32 random bytes per user, with a random key id. Stored only wrapped:
    AES-256-GCM under the KEK, with `twinllm.vault.v1|<user key>|<key id>|<purpose>` as
    additional data. The user key is computed from the person asking, never read from
    the file, so one person's file never opens for another.
  - Recovery code: 20 random bytes shown once as eight groups of four base32 characters.
    It wraps the same DEK under its own Argon2id key. Using it forces a new passphrase
    and issues a new code; the old code stops working.
  - Subkeys with HKDF-SHA256: #141 derives `field`, `index` and `mesh` (section 2.3);
    #140 adds `ledger`.
- **Where keys live.** _Changed from the first draft_, which put them in a `vault_keys`
  table. Each user's record is one owner-only JSON file,
  `$TWINLLM_STATE_DIR/vault/<user key>.json` (`infrastructure/vault-file.ts`): version,
  user key (a hash of the actor id, so the id is not on disk), key id, created and
  updated times, and for the passphrase and the recovery code each the KDF name,
  parameters, salt, IV and wrapped key. Why a file: the #144 startup check already
  refuses to start unless the state directory and everything in it is the owner's and
  `0700`/`0600`, so the key gets that check for free; a database dump alone never
  carries a wrapped key; and the unlock needs no migration. The cost: a backup must
  include the file as well as the database, which the runbook says. The file is written
  through a temporary file and a rename. An unreadable or malformed file is never taken
  for "no vault". #141's rotation adds a `retiring` list: keys being rotated out, wrapped
  under the same passphrase and recovery code until no row names them. The unwrapped DEK is a `KeyObject` in a process-wide map
  (`infrastructure/vault-session.ts`, kept on `globalThis` so every route bundle shares
  it): actor id to keys, open time, last use and the SHA-256 of the unlock token. The
  buffer it came from is zeroed. Never written to disk, logs, Prisma, the audit chain or
  a response.
- **Unlock flow** (`features/vault/`, routes under `app/api/vault/`). `POST
/api/vault/setup` (first run only; 409 once set up), `POST /api/vault/unlock` and
  `POST /api/vault/recover` take the passphrase (and code) in a JSON body, behind the
  same loopback Host and cross-site checks as every route. On success the server opens
  the session and sets `twinllm_unlock`, 32 random bytes: HttpOnly, SameSite=Strict,
  Path=/, a session cookie, and `Secure` when the request came over https (on
  `http://localhost` it is left off, because not every browser keeps a Secure cookie
  there). The server keeps only its SHA-256. Bodies are never logged. `GET
/api/vault/status` says `not-set-up`, `locked` or `unlocked` for the caller. Because a
  Strict cookie is not sent on a page reached from another site (the return from an
  OAuth provider), the unlock screen asks the status on load and reloads itself when
  the browser is in fact unlocked.
- **Gate.** `checkVault` in `infrastructure/vault-gate.ts` returns the keys or a refusal:
  HTTP 423 with `PERSONAL_DATA_LOCKED` ("Your data is locked. Unlock it to continue.")
  or `PERSONAL_DATA_NOT_SET_UP` ("Your data is locked until you set a passphrase. Set
  one to continue."). It is keyed by the actor id (`resolveActorId`). Synthetic mode
  always passes. It is used three ways: route files wrap their handler,
  `export const GET = withUnlocked(handler)` (`infrastructure/vault-runtime.ts`); personal
  pages start with `const locked = await lockedScreen(); if (locked) return locked;`
  (`features/vault/page-gate.tsx`), which renders the setup or unlock form; and personal
  server actions (starting a turn, onboarding answers, twin notes) return
  `vaultRefusalForAction()`'s sentence. The sidebar lists no thread titles while locked
  and says "Locked". Before #141 the gate is a check; after it, it is structural, because
  a store cannot decrypt without the keys.
- **What is gated.** Every route in the `tests/personal-reads` table without a
  `whileLocked` reason: the wearable summary, genome report and run, BodyLoop reads and
  writes, the Ark status, imports and dataset edits, search (except a docs-only search),
  thread export, `/compact` and saving notes, chat, incognito chat, chat suggestions,
  onboarding starters and the three syncs. Open while locked, each with its reason in the
  table: OAuth authorize and disconnect, connection status, the Ark audit list, the
  synthetic Demo routes, anatomy, motion, GBD, Synthea, the scanner upload (checked by its
  own secret; stores nothing yet) and the vault routes. Pages: home, threads, Customize ·
  Connectors, Data and Memory, and `/start`; the Lab, docs, models, skills, agents, the
  synthetic cohort explorer and the Digital Twin page (Demo bodies; its BodyLoop reads
  go through gated routes) stay open.
- **OAuth callbacks.** A provider's redirect is cross-site, so the Strict cookie is not
  sent. The callback is not behind the cookie gate: it stores the tokens (they keep their
  own env keys, see 2.3) and runs the first sync only when the person's vault is open in
  this process (`vaultOpenFor`); otherwise the person syncs after unlocking.
- **Chat and MCP.** In personal mode the chat route is gated as a whole, so no turn starts
  and no personal tool runs while locked. Passing the keys to the tool ports comes with
  #141, when the tools need them to decrypt. The MCP server already refuses the imported
  and genome tools in every mode, and its other tools read the synthetic warehouse, so it
  needed no change.
- **Lock.** `POST /api/vault/lock` (the Lock button at the foot of the sidebar), which
  locks only with the caller's valid cookie, so another user of the machine cannot lock
  it for them; idle lock after `VAULT_IDLE_LOCK_MINUTES` (default 15, allowed 1 to 240)
  without a personal request, checked on each gated request and by a one-minute timer
  that does not keep the process alive; and process exit. Looking at an open page (the
  sidebar's state) does not count as use. Locking deletes the map entry; the cookie
  becomes useless.
- **Brute force.** Argon2id cost, plus a per-user in-memory wait that doubles after each
  wrong passphrase or code from 1 s up to 60 s (429 with `Retry-After`, no KDF run), and
  is forgotten an hour after the last wrong try or at restart. Offline guessing against a
  stolen disk is limited only by the KDF and the passphrase's strength; the docs say so.
- **Passphrase change and recovery.** Recovery rewraps the DEK under the new passphrase and
  a new code; no data is rewritten. A form to change a known passphrase is not built yet;
  the same rewrap serves it.
- **Writes while locked.** Syncs, imports, renames, deletes, BodyLoop writes, notes and new
  turns are refused while locked with the same code. Syncs are started by the person, so
  this costs nothing today.
- **Multiple users.** With sign-in on, each user has their own file and passphrase;
  unlocking one user never unlocks another (tested).

**What the UI shows.** In personal mode, the first personal page shows "Set a passphrase"
with the passphrase typed twice, then the recovery code with Copy and "I have saved my
recovery code" before Continue. Locked pages show "Your data is locked" with the
passphrase and "Forgot your passphrase?", which opens the recovery form. The foot of the
sidebar shows Lock (unlocked) or Locked.

**Audit rows** (ids and counts only, `infrastructure/vault-audit.ts`). The event is in the
tool name, because the chain keeps args only as a hash: `vault.setup`, `vault.unlock`,
`vault.unlock.refused` (row count = wrong tries in a row), `vault.lock.manual`,
`vault.lock.idle`, `vault.recovery_used`, `vault.recovery.refused`. A restart leaves the
vault locked and writes nothing.

**Failure behaviour.** Fail closed: no keys, no personal read or write. If the unlock audit
row cannot be written, the unlock is undone. The setup row is written before the key file,
so a setup that cannot be recorded does not happen. A lock always locks, even when its row
fails. A lost passphrase and a lost recovery code mean the data key cannot be opened; the
person can still delete the data.

**Tests.** The `tests/personal-reads` table gained the `whileLocked` column: a route
without it must answer 423 when called locked (no passphrase set; set up but no cookie, a
wrong cookie, or another person's cookie), and a route that reads personal data may only
skip the gate with a stated reason (the three OAuth callbacks, whose locked return is
tested to store and audit nothing). The same file lists every page, layout and server
action as gated or open with a reason and fails on any it does not name. Pure tests for
the RFC vectors, a fixed KEK for the default parameters, wrap and unwrap with a pinned
output, wrong passphrase, other additional data, a changed byte, stored parameters and
their limits, the file round trip and modes, recovery and rewrap, idle timing with an
injected clock, the sweep and the backoff, the routes' cookie attributes, and the
`VAULT_IDLE_LOCK_MINUTES` bounds. The flow was run by hand in a browser against a
throwaway owner cluster ([runbook.md](runbook.md#local-unlock)).

**Effort.** About 5 days: crypto and session 1, routes and gate across routes and tools 2,
screens 1, tests and docs 1.

### 2.3 #141 Encrypt personal data at rest

**Decision.** Field-level encryption with AES-256-GCM under subkeys of the person's data
key from #142, for the personal columns listed below, and for BodyLoop mesh files. Columns
that are only needed to find rows hold a keyed hash (HMAC-SHA256) or stay plaintext, as
listed. The issue's "OS keyring, env-file fallback" is replaced by the passphrase: an
env-file key would sit next to the database and protect nothing against the threats above.
Encryption uses `node:crypto` `createCipheriv`, as `features/*/token-crypto.ts` already
does, because it is synchronous and fast for many small fields; Web Crypto's `subtle` is
async per call and slower for 200,000 rows.

**Design** (as built).

- **Subkeys** (`infrastructure/field-crypto.ts`, pure). HKDF-SHA256 of the data key with
  info `twinllm.<purpose>.v1`, one per purpose: `field` seals column values, `index` makes
  the keyed hashes, `mesh` seals mesh files. A rotation changes all three.
- **Envelope.** Binary: format version (1 byte), key id (8 bytes), a random 96-bit nonce,
  the ciphertext and the 16-byte tag. The additional data is the header (version and key
  id) followed by `|<table>.<column>.<row id>` with SQL names, so a value moved to another
  row, column or key, or relabelled with another key id or version, does not open. A text
  column holds `tlenc1.<key id>.<base64url envelope>`, so SQL tells sealed from plain
  (`LIKE 'tlenc1.%'`) and finds one key's rows during a rotation (`LIKE
'tlenc1.<key id>.%'`) without decrypting. _Changed from the first draft_, which had the
  nonce and ciphertext as separate text parts and no version byte. Tests: round trip of
  text, JSON, numbers and lists; one changed byte anywhere fails; wrong additional data,
  wrong key, unknown key id and an unknown version are refused; an error names the
  problem, never the value.
- **One module for every store** (`infrastructure/field-cipher.ts`). A store asks
  `cipherForUser(userId)` (`field-cipher-runtime.ts`) and seals before it writes and
  opens after it reads. A personal install gets a cipher built from the person's keys in
  this process's session store; while the vault is locked there are no keys, so the call
  throws `PersonalDataLockedError` and nothing is read or written. A synthetic install gets
  the plain cipher, which stores values as they are and refuses a sealed value. The gate
  of #142 still checks the unlock cookie in front of every route, page and action; after
  #141 a store cannot read without the keys even if a route forgot the gate. _Changed from
  the first draft_, which passed the keys to the tool ports: the stores look them up by
  the row's owner instead, so a thread is opened only for its owner
  (`findThread(threadId, viewerId)` refuses before opening anything).
- **Types.** Every encrypted column is a text column. JSON, numbers and string lists are
  sealed as their JSON text (`Json`, `Float`, `Int` and `String[]` columns became text in
  migration `20261031120000_encrypt_at_rest`). Stores set row ids (UUIDs) before sealing;
  rows written before keep their ids. Null stays null.
- **Keyed hashes** (`tlix1.` and the first 16 bytes of HMAC-SHA256 under the `index` key
  over `<table>.<column>|<value>`, hex). They allow equality lookups without showing the
  value; they show which rows share a value, not what it is. During a rotation a lookup
  asks for the hash under every key of the keyring.
- **Columns.** The list lives in `infrastructure/personal-columns.ts`, which the doctor,
  the Lab, the migration and rotation read; a test checks it against the schema.

| Table                                        | Encrypted                                                               | Keyed hash                                                                                                    | Stays plaintext, and why                                             |
| -------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `threads`                                    | `title`                                                                 |                                                                                                               | ids, dates                                                           |
| `turns`                                      | `prompt`                                                                |                                                                                                               | ids, dates                                                           |
| `model_responses`                            | `text`, `reasoningText`, `attribution`, `responseDocument`, `toolParts` |                                                                                                               | model id and name, status, timings, token counts                     |
| `thread_search_embeddings`                   | `embedding_sealed` (the vector as JSON); `embedding` is null            |                                                                                                               | ids, kind                                                            |
| `oura_`, `whoop_`, `google_health_snapshots` | `summary`, `fhirBundle`                                                 |                                                                                                               | `startDate`, `endDate`, `syncedAt` (to pick the newest window)       |
| `vitronic_snapshots`                         | `summary`, `markers`, `measures`, `fhirBundle`; the mesh file on disk   |                                                                                                               | ids, `glbSha256` (of the plaintext, for the pin check)               |
| `vitronic_subjects`                          | `label`, `consentNote`                                                  |                                                                                                               | consent time and actor                                               |
| `genome_reports` (user rows)                 | `rows`, `report`                                                        |                                                                                                               | `app`, `arkBuild`, dates; synthetic subjects' reports stay plaintext |
| `personal_datasets`                          | `name`, `source_file_name`, `sha256`, `first_at`, `last_at`             | `sha256_index` (the file's SHA-256)                                                                           | `kind`, `byte_size`, `row_count`, `status`, `genome_build`           |
| `personal_observations`                      | `code_system`, `code`, `display`, `value`, `unit`, `source_ref`, `note` | `lookup_index` (system and code, or the name of a row without one), `series_index` (system, code, name, unit) | `effective_at` (range queries), `effective_precision`, `unit_ucum`   |
| `personal_clinical_records`                  | `code_system`, `code`, `display`, `status`, `source_ref`                |                                                                                                               | `resource_type`, `start_at`, `end_at`                                |
| `personal_tables`, `_chunks`                 | `columns`, `rows`                                                       |                                                                                                               | counts, chunk index                                                  |
| `personal_variants`                          | `chrom`, `pos`, `variant_id`, `ref`, `alt`, `genotype`, `filter`        | `site_index` (`chrom:pos` as written), `variant_id_index` (one per ID in the cell, GIN index)                 | none of the content                                                  |
| `twin_notes`                                 | `title`, `topics`, `measures`, `open_questions`                         |                                                                                                               | `data_mode`, `permit`, dates                                         |
| `onboarding_profiles`                        | `interest`                                                              |                                                                                                               | roles and steps (fixed choices)                                      |

- _Changed from the first draft:_ `personal_datasets.sha256` stays (sealed) next to its
  keyed hash, so a rotation can compute the hash under the new key; clinical records have
  no keyed hash of `code`, because no query looks them up by code. `disclosure_events`
  joins the list with #140.
- **Not encrypted, on purpose.** The synthetic warehouse, guidelines and knowledge chunks
  (public or synthetic). `audit_events` (hashes, ids and counts only; it must verify while
  locked). `user_skills` (instructions the person wrote, not records; listed so the choice
  is visible). OAuth and BodyLoop tokens keep their own AES-256-GCM env keys
  (`*_TOKEN_ENCRYPTION_KEY`); moving them under the vault is a later step, because an OAuth
  callback can arrive while locked. Row counts, dates, which values are null and which rows
  share a hashed value stay visible (section 1, out of scope).
- **Queries.** Tools that filter by code, name, site or rsID use the keyed hashes and
  `effective_at`, then open the matching rows. `imported_datasets`' series list groups by
  `series_index` in SQL and opens one row per series to name it. Sorting by a sealed value
  (conditions and medications by name, variants by position) happens in memory after
  opening, before the `take` cut. The current tools needed nothing else.
- **Thread search.** Personal installs keep vectors sealed and search one person's titles,
  prompts, answers and vectors in memory after unlock (cosine distance, as pgvector's
  `<=>`). Synthetic installs keep `ILIKE` and the pgvector HNSW index.
- **Mesh files** (`infrastructure/mesh-files.ts`, `packages/vitronic/glb.ts`). Personal
  mode writes `<sha>.glb.enc`: the binary envelope under the `mesh` key with
  `vitronic.mesh.<user id>.<sha>` as context, written through a temporary file and a
  rename. Reading checks the plaintext against the hash in its name.
- **Rotation** (`bun run vault:rotate`, app stopped). _Changed from the first draft_,
  which put a Rotate button on Customize · Privacy while unlocked: that page is not built
  yet, and rewriting rows under a running app would leave its session with only the old
  key. The command asks for the passphrase, makes a new data key, keeps the old one in the
  key file's `retiring` list and rewraps both under the passphrase and a new recovery code
  (the old code cannot be read back to rewrap the new key, so it is replaced and shown
  once). It rewrites every row and mesh file that names a retiring key in batches of 500
  per transaction, recomputes the keyed hashes, and removes the retiring key once no row or
  file names it. Unlocking during a rotation opens both keys; the app reads with both and
  writes with the new one. Resumable: a stopped run carries on at the next. Audited as
  `vault.rotate.start` and `vault.rotate` with counts. A passphrase change rewraps only
  (2.2).
- **Doctor and Lab.** `bun run doctor` has an "Encryption at rest" section, and the Lab a
  card of the same name: rows per listed column that hold a non-null value not starting
  with `tlenc1.`, and plain search vectors. Any count above zero in personal mode is Not
  OK, with table and column names and counts, never a value; synthetic mode is Unknown
  (nothing to encrypt). The doctor also warns while a pre-encryption backup exists. The
  card's command is the doctor and a `psql` count with the same `LIKE` test.

**What the UI shows.** Customize · Data says "Stored on this machine in TwinLLM's
database, encrypted with your passphrase." The Lab card above. Customize · Privacy (key
id, its age and a Rotate button) is not built; rotation is the command.

**Failure behaviour.** A value that fails to decrypt (wrong key, edited ciphertext, moved
value) is an error for that request (`FieldDecryptError`, logged by error name only),
never a silent empty value. A write that cannot encrypt is not made: imports seal every
row before their transaction opens. Migration and rotation stop at the first value that
does not open or does not check, before that batch is written, and resume.

**Tests.** The envelope (above); the keyring with mixed key ids; the typed helpers; keyed
hash lookups for codes, names, sites and rsIDs (an rsID matches a whole cell or one part
of a `;` list, never a prefix); the registry against the schema and its SQL; the reseal
walk over an in-memory table (batches, a stop mid-way that rolls back one batch, resume,
a second run that changes nothing, rotation, other owners untouched); mesh files
(migration, resume, rotation, a file that does not match its hash); the session's keys and
the locked cipher; recovery and unlock with a retiring key; the doctor lines and the Lab
card; store fixtures sealed with a test key in the route and BodyLoop tests. The
migration, rotation and the app on a throwaway owner cluster, with a `pg_dump` free of
fixture text: [runbook.md](runbook.md#encryption-at-rest). There is still no CI job with
a Postgres.

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
| 2    | #142  | #144 (state dir, loopback)                         | Built: new `infrastructure/vault*.ts` (key file in the state directory, no migration), `features/vault/`, `app/api/vault/*`, every gated route, page and server action in `tests/personal-reads/personal-reads.test.ts`, the OAuth callbacks, the sidebar and the first-run screens                                                                                    |
| 3    | #141  | #142 (keys)                                        | Built: migration `20261031120000_encrypt_at_rest`, `infrastructure/{field-crypto,field-cipher,personal-columns,reseal,mesh-files,thread-fields}.ts`, every store of the tables in 2.3, `features/search`, `scripts/vault/{migrate,rotate}.ts`, doctor, Lab                                                                                                             |
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
  migrate. The #141 migration changes column types; synthetic rows keep their values as
  plain text (JSON as its text, lists as JSON arrays). `vault:migrate` refuses to run.
  #144's checks apply; #300 creates a key at the next `setup:local`.
- **Personal installs** (as built for #141, [runbook.md](runbook.md#encryption-at-rest))
  migrate in place, with the app stopped:
  1. `bun run db:deploy`: the schema migration turns the listed columns into text and
     adds the keyed-hash columns, empty. It encrypts nothing; the app refuses to read the
     plain rows until step 2 is done.
  2. `bun run vault:migrate` refuses in synthetic mode and while another session uses the
     database. It backs up first: `pg_dump --format=custom` to
     `$TWINLLM_STATE_DIR/backups/pre-encryption-<time>.dump` (mode `0600`) and a copy of
     the person's mesh folder, and prints the path and the dump's SHA-256 (or takes
     `--backup <file>`). It goes on only when the person types `backed up` (or passes
     `--backup-confirmed`).
  3. It unlocks the vault with the passphrase on the terminal (no echo), or sets one up
     and shows the recovery code, which the person confirms they saved.
  4. It drops the plain search vectors (the app rebuilds them sealed) and seals every
     listed column in place, in batches of 500 rows per transaction, checking each value
     by decrypting it and comparing with the source, and computes the keyed hashes.
     _Changed from the first draft_, which added encrypted columns next to the old ones
     and dropped the old ones in a second migration: the in-place walk only selects rows
     that still need work, so it is resumable and idempotent, and the backup is the undo.
  5. It seals the mesh files, checks them, then removes the plain copies.
  6. It checks that no row of the person is left unsealed and writes `vault.migrate` with
     counts.
  7. The doctor warns while a pre-encryption backup exists, because it holds plaintext.
     The person decides when to delete it; the command prints how.
- **Undo.** Restore the backup (and the mesh copy) and remove the key file if the
  migration created it. Until the backup is deleted it is the only plaintext copy.
- **Tests.** The walk over an in-memory table: batches, a stop mid-way, resume, a second
  run, rotation. The whole migration was run by hand on a throwaway owner cluster seeded
  from the made-up fixtures in `tests/fixtures/personal-import/` and a genome-synth VCF
  ([runbook.md](runbook.md#encryption-at-rest)); a CI job with a Postgres is still open.

## 5. Open questions for Peter

1. **OS keyring.** Decided: no, for now. Should a later step offer "remember on this machine" (macOS Keychain,
   Linux Secret Service) instead of typing the passphrase? It is convenient, but the
   keyring opens for any program running as the owner after login, which undoes most of
   what locking gives. The default here is no.
2. **Idle lock.** Decided: 15 minutes by default (`VAULT_IDLE_LOCK_MINUTES`, 1 to 240).
3. **Anchors off the machine.** Is a manual `anchor:export` enough, or should anchors also
   go somewhere automatically, such as a commit to a private repository? Automatic would
   be a new outgoing channel, and would get its own ledger entry.
