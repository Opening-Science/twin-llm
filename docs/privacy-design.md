# Privacy design: unlock, encryption, hardening, consent, ledger, anchor

This document settles the decisions behind six issues so each can be built as its own
pull request: #144 harden local storage, #142 local unlock, #141 encryption at rest, #145
learning consent, #140 disclosure ledger and #300 an external anchor for the audit chain.
Status: all six are built (sections 2.1 to 2.6 describe what shipped). Where this
document and the code differ, the code is what runs; update
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
  thread export and delete, `/compact` and saving notes, chat, incognito chat, chat suggestions,
  onboarding starters and the three syncs. Open while locked, each with its reason in the
  table: OAuth authorize and disconnect, connection status, the Ark audit list, the
  synthetic Demo routes, anatomy, motion, GBD, Synthea, the scanner upload (checked by its
  own secret; stores nothing yet) and the vault routes. Pages: home, threads, Customize ·
  Connectors, Data and Memory, and `/start`; the Lab, docs, models, skills, agents, the
  synthetic cohort explorer and the Digital Twin page (Demo bodies; its BodyLoop reads
  go through gated routes) stay open.
- **OAuth callbacks.** A provider's redirect is cross-site, so the Strict cookie is not
  sent. The callback is not behind the cookie gate: it exchanges the code, stores the
  tokens and runs the first sync only when the person's vault is open in this process
  (`vaultOpenFor`). _Changed by #341:_ the tokens are sealed with the vault key (2.3), so a
  return while locked exchanges nothing, stores nothing, writes a
  `vault.locked.skip.connect-<provider>` audit row and lands on Connectors with "Your data
  is locked, so Oura was not linked. Unlock it, then link Oura again." Before #341 it
  stored the tokens under their env keys and skipped only the first sync.
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
passphrase and "Forgot your passphrase?", which opens the recovery form. Its button,
"Hold to replace passphrase and recovery code", has to be pressed and held (#350), since
the old passphrase and code stop working; Enter in a field does not submit it. The foot
of the sidebar shows Lock (unlocked) or Locked.

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
tested to exchange and store nothing and to write only its skip row). The same file lists every page, layout and server
action as gated or open with a reason and fails on any it does not name. Pure tests for
the RFC vectors, a fixed KEK for the default parameters, wrap and unwrap with a pinned
output, wrong passphrase, other additional data, a changed byte, stored parameters and
their limits, the file round trip and modes, recovery and rewrap, idle timing with an
injected clock, the sweep and the backoff, the routes' cookie attributes, and the
`VAULT_IDLE_LOCK_MINUTES` bounds. The flow was run by hand in a browser against a
throwaway owner cluster ([runbook.md](runbook.md#local-unlock)).

**Effort.** About 5 days: crypto and session 1, routes and gate across routes and tools 2,
screens 1, tests and docs 1.

**Scheduled runs (#54).** A scheduled task runs on the server with no browser and no
cookie, so it asks the session store directly: in personal mode it runs only while the
owner's vault is open in this process, and asking does not count as use, so a schedule
never keeps the vault from idle-locking. Locked at the scheduled time, the run is skipped,
its `task.run` row says `skipped: locked`, and it waits for its next time. The turn then
uses the same keys and the same pipeline as a typed turn; anything sent to a hosted
provider goes through the disclosure ledger as usual ([skills.md](skills.md#scheduled-tasks)).
The notice the shell polls answers zero while locked instead of touching the session.

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
| `scheduled_tasks`                            | `question`                                                              |                                                                                                               | skill, model id, schedule, time zone, run status and dates           |
| `onboarding_profiles`                        | `interest`                                                              |                                                                                                               | roles and steps (fixed choices)                                      |

- _Changed from the first draft:_ `personal_datasets.sha256` stays (sealed) next to its
  keyed hash, so a rotation can compute the hash under the new key; clinical records have
  no keyed hash of `code`, because no query looks them up by code. `disclosure_events`
  joined the list with #140: its `refs` column, for rows that are not synthetic.
- **Not encrypted, on purpose.** The synthetic warehouse, guidelines and knowledge chunks
  (public or synthetic). `audit_events` (hashes, ids and counts only; it must verify while
  locked). `user_skills` (instructions the person wrote, not records; listed so the choice
  is visible). `learning_consents` (#145: fixed choices, dates and a shipped sentence;
  the consent gate must read it while locked). Row counts, dates, which values are null
  and which rows share a hashed value stay visible (section 1, out of scope).
- **OAuth and BodyLoop tokens (#341).** `oura_`, `whoop_` and
  `google_health_connections` (`accessTokenEnc`, `refreshTokenEnc`) and
  `vitronic_connections` (`apiTokenEnc`, `uploadSecretEnc`) are in the registry like any
  other personal column (`infrastructure/connector-tokens.ts`). Each value is the
  provider's env-key ciphertext (`*_TOKEN_ENCRYPTION_KEY`, `features/*/token-crypto.ts`)
  sealed again with the `field` subkey, so a copied row opens with neither key alone, and
  `vault:migrate` seals rows from before #341 without needing the env keys. Nothing opens
  or stores a token while the owner's vault is locked: an OAuth return skips (2.2), and
  the BodyLoop scanner's upload, which comes with no browser, answers 423 and writes a
  `vault.locked.skip.bodyloop-upload` row without opening its secret (at most one per
  connection per 10 minutes, kept in memory; an unknown connection id gets 401 and no
  row), as a scheduled task
  skips (#54). Checking the vault does not count as use. Synthetic installs keep the
  env-key ciphertext as it was. _Changed from the first draft_, which left tokens under
  their env keys because a callback can arrive while locked.
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
only on Customize · Privacy, audited. Every learning pipeline asks one gate before it
reads a row and refuses any row that is not synthetic unless a matching consent holds.
Making a twin note, searching threads, loading notes and exporting a thread are the
person's own use, not learning, and need no consent.

**Design** (as built).

- **Table `learning_consents`** (migration `20261031130000_learning_consents`). User id;
  scope: `training` (fine-tuning sets), `answer-key` (evaluation keys), `evaluation`
  (scoring runs); sources, a list from `wearables`, `imports`, `genome`, `chat`, `notes`,
  `body-scans`; the exact sentence shown, its wording version (`learning-consent.v1`) and
  its SHA-256; granted time; withdrawn time; the `seq` of the audit row that granted it. A
  row is never edited except to set the withdrawn time; granting again after a withdrawal
  adds a row. At most one active grant per scope. _Changed from the first draft:_ the
  person ticks the sources a grant covers (none ticked by default), and the wording
  version is stored next to the sentence. **Plaintext on purpose**, like `audit_events`:
  the row holds fixed choices, dates and a shipped sentence, no health data, and the gate
  must read it from a command line where the vault is not open. Section 2.3 lists it
  under "Not encrypted, on purpose".
- **Gate** (`infrastructure/learning-consent.ts`). `permitLearningUse({ scope, rows,
consents, at })` is pure; `requireLearningConsent(scope, rows, deps)` is the one
  function pipelines call: it reads consents through an injected `loadConsents` only when
  a row is not synthetic, counts a failed read as no consent, and returns a permit with
  the consent ids it relied on or the first refusal. A row is a warehouse subject (cohort
  and `is_synthetic`) or a person's own row (owner and source). A subject is synthetic only
  when it is `is_synthetic` and its cohort is in `SYNTHETIC_COHORTS`. Refusal codes, each
  with a plain sentence naming the source and the use: `SOURCE_NOT_SYNTHETIC` (a subject
  that is not synthetic has no owner who could consent, so it is always refused),
  `LEARNING_CONSENT_MISSING`, `LEARNING_CONSENT_WITHDRAWN` (with the date) and
  `LEARNING_CONSENT_SCOPE` (a consent exists but for another use, or it leaves out this
  source; _changed from the first draft_, which had no case for a source left out).
- **Where it runs.** Every package script is listed in
  `tests/learning-consent/pipelines.test.ts` as gated or with the reason it reads no row
  a model could learn from; a new script, or a new entry file under
  `scripts/training-data`, `scripts/evaluation` or `scripts/heart-brain`, fails that test
  until it is listed. Gated: `training:conversations` and `training:sample` (each subject
  of the cohort, before the first tool call and again before the files are renamed into
  place), `training:batches` (every subject in the training database), `training:split`
  (each conversation's meta line), `disclosure:prepare` (each meta line of the set the
  disclosure experiment trains and probes on), `eval:answer-key` and its `:s7`, `:s7b`,
  `:s7h`, `:v1h`, `:hb` and `:live` forms (before the first call and before the key is written; over cohort files,
  only Synthea bundles count as synthetic), `eval` (before any model runs and before
  `meta.json`, whatever the decline wording or context arm), `eval:report`, `eval:spread-subjects`, `eval:cohort-codes` and
  `eval:heldout:s7h` and `eval:heldout:v1h`. _Changed from the first draft:_ the Lab's training sample is
  `training:sample`, no separate path; the report, spread, cohort-codes and held-out
  commands were added to the list.
- **Manifests.** A set or run that relied on a consent records `learning_consents: {
scope, consent_ids }` in its manifest (`<out>.manifest.json`, `meta.json`), so it can be
  found after a withdrawal. A synthetic run relies on none and leaves the field out, so
  its files stay byte for byte as before (`tracks.test.ts` pins them). The committed
  answer keys, cohort codes and held-out set are keyed to a named synthetic cohort by
  their schema, so they never name a consent and their format is unchanged.
  `eval:report` reads files only and cannot check a consent again, so it refuses a run
  that names one.
- **Which consent store.** A pipeline that connects to a database reads
  `learning_consents` of that database (`databaseLearningGate()`). Commands that read
  files only (`training:split`, `disclosure:prepare`, `eval:report`, the cohort-file
  modes) have no consent store
  (`noConsentStore()`), so a personal row is always refused there.
- **Scope of this step.** No pipeline reads personal rows today: each runs with
  `DATA_MODE=synthetic` against its own database and keeps that refusal. This step builds
  the record, the screen and the gate, and puts the gate in front of every pipeline. A
  pipeline that reads personal rows needs its own decision (which database it reads, how
  it opens the vault) and must pass this gate.
- **Not learning, on purpose.** `/compact` drafts and saved twin notes: the person writes
  and saves each note, and it is loaded only into their own chats (switchable on
  Customize · Memory). Thread search and the thread export (Markdown, PDF, FHIR): the
  person's own copy of their own data; #140 adds the export to the disclosure ledger.
  `mcp:serve`, every `heart-brain` command (Synthea archives by batch number, no path to
  the app database), `rhythm-bench` (simulated signals and the public PhysioNet AFDB),
  `disclosure:analyze` and `eval:hb-verdicts` (they read outputs of gated runs, no
  subject row) are listed with these reasons.
- **Withdrawal.** Sets the withdrawn time, then writes `learning.consent.withdraw`. Future
  runs refuse, including one already running when it asks again before writing. The
  screen says plainly that a model already trained cannot unlearn and that sets, keys and
  scores made while the consent held stay until the person deletes them, each naming the
  consent in its manifest. _Changed from the first draft:_ the screen does not list those
  sets, because no pipeline can make one yet; it names the manifest field instead.
- **Audit rows** (`learningAuditEvent`): `learning.consent.grant` and
  `learning.consent.withdraw`, with the consent id and the number of sources only, never
  the sentence.

**What the UI shows.** Customize · Privacy, "Learning from your data": one card per use,
Off by default, with the data it may read as checkboxes (none ticked) and Grant; once
granted, "On since <date>", what it covers, the sentence agreed to, and "Hold to withdraw
consent", pressed and held because a withdrawal cannot be taken back (#350); earlier
grants that were withdrawn are listed under the card. It states that removing names or
dates does not replace consent, that the person's own use needs none, and what
withdrawing does and does not undo. Gated by the unlock like every personal page. In
synthetic mode the page says there is nothing to consent to and the actions refuse.

**Failure behaviour.** Fail closed. A consent table that cannot be read counts as no
consent. A grant writes its audit row first and is not stored if that fails. A withdrawal
is never blocked: the withdrawn time is set first, and an audit row that cannot be written
is logged by error name.

**Tests.** The gate's table of cases (`infrastructure/learning-consent.test.ts`): a
synthetic row passes with no consent and no consent read; an unflagged subject or an
unlisted cohort is refused; a personal row is refused without consent, with a withdrawn
one, with another scope's and with one that leaves out its source; another person's
consent does not count; a failed read is no consent. Per pipeline, next to it: a subject
that is not synthetic is refused before any tool runs or file is written
(conversations, batches, split, answer key, eval, report, spread); for conversations,
eval and the answer key also a personal row without consent, withdrawn and of another
scope; a consent withdrawn during a run keeps nothing (conversations) or writes no
`meta.json` (eval); the manifest names the consent ids. The entry-point list above. The
screen, grant, withdraw, audit rows and the gate against the database were run by hand on
a throwaway owner cluster ([runbook.md](runbook.md#learning-consent)).

**Effort.** About 3 days.

### 2.5 #140 Disclosure ledger

**Decision.** A separate hash-chained table, `disclosure_events`, with one entry per event
in which data leaves this machine or a device of the person's reaches it. It reuses the
audit chain's hashing and is written in the same transaction as an audit row for the
event, before the data is sent. The Lab and Customize · Privacy show running totals per
recipient.

**Design** (as built).

- **One function.** Every outbound path calls `recordDisclosure`
  (`infrastructure/disclosure-ledger-runtime.ts`) before it sends. It seals the value
  references (below), then writes the paired audit row and the ledger row in one
  transaction (`appendInTransaction` and `appendDisclosureInTransaction` in
  `packages/audit`). Any failure rejects with `DisclosureNotRecordedError` (the error's
  name only) and the caller does not send. The pure half (types, the audit row, the
  recorder over an injected writer, the recording fetch, the cumulative view) is
  `infrastructure/disclosure-ledger.ts`.
- **Events and recipients.** _Changed from the first draft_, which recorded only
  personal requests to the Exoscale pilot, vendor syncs, exports and Ark releases: every
  send to a recipient off this machine is recorded, and a send that carried synthetic data
  only is recorded too, labelled `synthetic`. Ollama on loopback is not a recipient.
  Providers that the data-mode policy refuses never get an entry, because nothing is
  sent.

| Kind            | When                                                                                                                               | Recipient                                                         | What is recorded                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `hosted-model`  | Each HTTP request to a model not on this machine: chat answers (every step of the tool loop), `/compact` drafts, starter questions | The provider (`exoscale`, `openrouter`, ...) and the model id     | Purpose, categories, the injected value references, the request's exact size                    |
| `vendor-sync`   | An Oura, Whoop or Google Health sync (a token refresh happens inside it)                                                           | The vendor                                                        | Access token and date window; no health value is uploaded. Oura's sandbox is labelled synthetic |
| `vendor-auth`   | The OAuth code exchange on the return from the vendor (only while the vault is open, #341)                                         | The vendor                                                        | The authorization code                                                                          |
| `export-file`   | A thread export (`/api/threads/<id>/export`, Markdown, FHIR or print), paired with its existing `thread.export` audit row          | `export file` and the format                                      | Categories and the file's size                                                                  |
| `ark-release`   | A genome report released from the person's Ark, after it parses and before it is stored                                            | `this machine, from the Ark`; direction `received`                | The panel sites as references (rsIDs of the app's fixed panel, never a genotype)                |
| `remote-tool`   | A question to the remote GBD server (synthetic requests only)                                                                      | `GBD server`                                                      | The question's size                                                                             |
| `embedding`     | A guideline or knowledge search query embedded by an Ollama that is not on this machine                                            | `ollama on another machine`                                       | The request's size                                                                              |
| `telemetry`     | A server-side PostHog event, when PostHog is configured                                                                            | `PostHog`                                                         | The event name; ids and counts only                                                             |
| `public-lookup` | Each HTTP request of a live PubMed or Ensembl lookup (#6), only for a source the person switched on                                | `NCBI PubMed` or `Ensembl`, and the step (`esearch`, `gene`, ...) | `search terms` or `public record ids` and the address's size; never a stored value              |

- **Hosted models, per request.** _Changed from the first draft_, which wrote one row per
  turn next to `provider.personal_data_sent`. `resolveLanguageModel` takes the caller's
  `disclosure` (who, why, categories, references) and gives the provider a recording
  fetch (`modelCallFetch`): each HTTP request is written with its body's size before it
  goes out, so the tool loop's later requests, which carry tool results, are counted too.
  The `provider.personal_data_sent` row stays as it was, one per turn. Only the
  evaluation harness and the live tool-call smoke test pass `{ notRecorded }` (synthetic
  cohorts, their own database); `tests/disclosures/outbound-paths.test.ts` lists them.
- **Which values left.** As references, never values: the wearable and BodyLoop keys the
  Twin prompt lists (`offeredKeys`, such as `oura.sleep.score.2026-10-20`), the ids of
  the twin notes a turn loaded, and the Ark panel's rsIDs. Each keeps its source
  (`wearable`, `scan`, `note`, `genome`). The list is sealed under the field key (#141)
  in personal mode.
- **Free text check** (#346). Before each hosted-model request is recorded, the recording
  fetch (`modelCallFetch`, with `freeTextCheckerFor` from
  `infrastructure/free-text-check-runtime.ts`) reads the string values of the request body
  (the person's words, earlier answers, tool results) and looks for values stored here:
  rsIDs and genome sites (`chr7:117559590` or `7:117559590`, positions of four digits or
  more), hashed with the person's index key and looked up in the keyed hash columns of
  their imported VCFs, so no variant is opened; and, as whole words ignoring case, the
  file names of their imports, their body scan labels other than their own subject, and
  their account id when it is not a plain word. Then the person's stored values, opened
  once per model call because none of these stores keeps a keyed hash of a value
  (`storedValueMatches`): a **lab value** is a stored reading's number followed by its own
  stored unit (`195 mg/dL`, `5.40mmol/L`; numbers compared as numbers, units ignoring
  case); a **coded value** is a stored reading's code (four characters or more, with a
  digit) as a whole token with that reading's own number within 80 characters, not
  counting the code's own digits; a **clinical record** is a stored Condition or
  MedicationRequest whose code stands as a whole token or whose name, 24 characters or
  more, stands as a whole phrase (shorter names such as "Asthma" are words anyone
  writes); a **twin note line** is a note title or list line of 24 characters or more as
  a whole phrase, ignoring case and spacing. A stored value that also stands in what the
  person typed in the call's messages (`typed`: the `user` messages of a chat turn and of
  its Ultra number check, and the questions of a thread a `/compact` draft summarises;
  starter questions pass none, #414) is not counted: they sent it themselves, even where an answer repeats it. Names, file
  names and genome identifiers are counted wherever they stand, as before. These four
  kinds are record-only: they are the person's values, not identifiers, so option C
  (#356) does not apply. Wearable numbers are not searched: a bare number such as a
  heart rate matches too much ordinary text, and wearable summaries are sent on purpose
  and recorded as references above. The row stores `free_text_checked = true`
  and `free_text_matches`, a list of `{ kind, count }` (distinct values per kind), never a
  value; the paired audit row carries the same list. The matcher is pure
  (`infrastructure/free-text-check.ts`), with at most 500 sealed lookups per request; the
  stored values are matched in memory against values already opened, so they make no
  lookups and the cap stays as it was. A body
  that cannot be read up front, or a check that fails (a locked vault), is recorded as
  not checked, with the error's name in the log. _Limits:_ approximate. A value written another way (a unit
  conversion, a rounded number, a decimal comma, another spelling) is missed, a value
  the person typed and a reply repeats is not counted, and wearable numbers are not
  searched; wearable and twin note values are recorded as references above. Exports, embeddings and live lookups are not
  checked (live lookups have their own query check).
- **Blocking genome identifiers** (#356, option C). When the check finds an rsID or a
  genome site that the person's VCFs hold, the request is not sent: `modelCallFetch`
  writes the row with direction `blocked` (the paired audit row's result says `blocked`
  too), still with kinds and counts only, and the fetch rejects with
  `GenomeIdsBlockedError` (`sendDecision` in `infrastructure/disclosure-ledger.ts`). The
  chat stream stores the answer row as `REFUSED` with the fixed sentence "This question
  would have sent identifiers from your genome to a hosted model, so it was not sent. Ask
  with a local model, or without the variant IDs." and the answer column shows it. If the
  blocked row cannot be written, the request is still not sent and the error's name is
  logged. Every other kind (file names, body scan labels, the account id) is recorded and
  the request goes. _Fail closed for genome-shaped text:_ when the check fails (a locked
  vault) and the text holds anything shaped like an rsID or a site (`rs` and digits, or a
  chromosome 1 to 22, X, Y, M or MT with a position of four digits or more), the request
  is blocked with `free_text_checked = false`, since it cannot be told whether the value
  is the person's own; on other text a failed check is recorded as not checked and the
  request goes. A body that cannot be read up front is not checked and goes. Ollama on
  loopback is not a recipient, so it is neither checked nor blocked. _Limits:_ the same
  as the check above: an identifier written another way is not found, so the block is
  a safeguard, not a guarantee. The single-prompt callers show the same sentence (#414):
  a `/compact` draft falls back to the person's own questions with it as the notice,
  starter questions fall back to the fixed ones with it above them, and the Ultra number
  check is a failed check whose step shows it.
- **Row.** `seq`, row id, time, actor (like the audit log; _changed from_ the user id),
  kind, direction (`sent`, `received` or `blocked`), recipient, target (model id, request kind or format), purpose,
  categories, `ref_count`, `payload_bytes` (null when it cannot be measured up front),
  thread id when there is one, `synthetic`, `free_text_checked`, `free_text_matches`
  (#346; null when the check did not run), the sealed `refs`, the
  paired audit `seq`, `prev_hash` and `hash`. The hash (`packages/audit/disclosure-chain.ts`)
  covers every column but `refs`, so `vault:rotate` can reseal it without breaking the
  chain (`free_text_matches` only when set, so rows written before it keep their hashes); `ref_count` is covered, and the sealed value is bound to its row by its
  encryption context. _Left out:_ the HMAC of the payload under a `ledger` subkey. Nothing
  can check it against a person's copy yet, and a rotation would leave old ones
  uncheckable.
- **Shared chain.** `packages/audit/chain.ts` has the one hash (`hashLink`, which the
  audit log's `hashEvent` now uses), `nextLink` and the walk (`checkLinks`); the audit log
  and the ledger each only say which fields their canonical form holds.
- **Order.** Ledger row and audit row in one transaction, then the send. If the
  transaction fails, nothing is sent.
- **Outside the ledger, named.** Clerk sign-in, Arcjet request protection and PostHog in
  the browser cannot be recorded by the server before they send (the first two are per
  request, the last is the browser's). The Lab card lists whichever are configured. The
  BodyLoop scanner on the local network is not a recipient here: the request carries its
  pairing token and ids and the scan comes in.

**What the UI shows.** Customize · Privacy, "What left this machine" (behind the unlock,
like the page): one line per recipient and direction with events (and how many were
synthetic), values, size, first and last time; then the latest 100 events, each with
recipient, purpose, what it carried, size, a Synthetic badge where it applies, a link to
the thread, its stored values as references under "Which stored values", and "Free
text": the kinds and counts the check found (a warning badge when there are any), "no
stored values found", or "not checked". A blocked request (#356) reads "Blocked" where
the others read "Sent", and has its own line in the running totals. The Lab
card "What left this machine" checks the chain while locked too and shows the running
totals only to a viewer whose data is unlocked (_changed from the first draft_, which
showed counts while locked). Its command is
`verify-cli.ts --check --chain disclosures`. _Not built:_ a cumulative chart over time;
the table holds the running totals.

**Failure behaviour.** Fail closed on every path: a chat or `/compact` model call fails
before the request (a draft falls back to the person's own questions; starter questions
fall back to the fixed ones), a sync reports failed before the vendor is asked, an OAuth
return goes back with an error before the code is exchanged, an export answers 500
with no file, an Ark report is not stored, a GBD call returns no rows marked
`gbd-not-recorded`, a remote embedding has no vector, a PostHog event is dropped, a live lookup returns `LIVE_SOURCE_NOT_RECORDED` and sends nothing more. A
database that has not run the migration refuses every one of these, including GBD calls
from the evaluation harness, until `bun run db:deploy`.

**Tests.** Per path with a failing ledger, checking nothing was sent: the hosted model
through the AI SDK for chat, `/compact` and starters
(`tests/disclosures/hosted-model-ledger.test.ts`), syncs and the code exchange
(`audited-sync`, `sync-route`, `oura/oauth-route`, and the Whoop sync route against a fake
database), exports, the Ark release, GBD and remote embeddings. The table of outbound
paths (`tests/disclosures/outbound-paths.test.ts`) walks `app`, `features`,
`infrastructure`, `packages` and `scripts` for outbound clients and fails on any it does
not name. The chain over seeded rows, each kind of tampering, a removed row and a
resealed `refs`; the writer over a fake transaction (both rows or neither, refs sealed,
no key needed without refs); the cumulative view and the two views as pure functions;
the CLI's `--chain`. The free text check (#346): the matcher on synthetic text
(`infrastructure/free-text-check.test.ts`), the recording fetch with a checker that finds,
fails or is absent, the chain with and without `free_text_matches`, and a chat request
through the AI SDK (`tests/disclosures/hosted-model-ledger.test.ts`). Run by hand on a throwaway owner cluster with a local stand-in
model server: chat, `/compact` and both exports wrote their rows before the requests,
the chain verified with the command, and the Lab card and the Privacy section were
checked locked and unlocked, light and dark.

**Effort.** About 5 days.

### 2.6 #300 An external anchor for the audit chain head

**Decision.** A dedicated Ed25519 key, generated at setup and kept outside the repository
and the database, signs the head of the audit chain and of the disclosure ledger. It is
not the git signing key: Peter chose a key that does one job, so rotating or losing it
touches nothing else.

**Design** (as built).

- **Key.** `bun run anchor:init` (also run by `setup:local`) calls
  `generateKeyPairSync("ed25519")` from `node:crypto` and writes
  `$TWINLLM_STATE_DIR/anchor/anchor-key.pem` (PKCS#8, mode `0600`) and `anchor-key.pub`
  (SPKI, `0600`), in a directory of mode `0700`, which the #144 owner-only check walks
  with the rest of the state folder. The key id is the SHA-256 of the public key, shown in
  the Lab with the public key itself. The private key is not encrypted with the vault
  passphrase, so anchors can be written while locked and in synthetic installs. Anyone who
  can read the key file as the owner can forge anchors; that is the stated limit.
- **Anchor file.** One JSON line per record in `$TWINLLM_STATE_DIR/anchor/anchors.jsonl`
  (`0600`, appended under a lock file), each with an Ed25519 signature `sig` over its
  canonical JSON without `sig`, and `prev`, the SHA-256 of the line before, so a removed
  line in the middle shows. _Changed from the first draft_, which had anchor lines only:
  the first line (`kind: "key"`) names the first public key, signed by it; anchor lines
  (`kind: "anchor"`) hold `{ v: 1, chain, seq, hash, headTs, at, keyId, prev }`, one line
  per chain (`audit`, `disclosures`); rotation lines are described below.
  `packages/audit/anchor.ts` has the pure record format, signing, the line-by-line check
  and the comparison; `anchor-store.ts` the files; `anchor-chains.ts` the database reads.
- **When.** The server reads both heads every minute and writes an anchor for each chain
  whose head moved, at most once per `AUDIT_ANCHOR_INTERVAL_MINUTES` (default 10, 1 to
  1440), and once more on SIGTERM and SIGINT (`instrumentation.ts`,
  `infrastructure/anchor-runtime.ts`). The shutdown write is synchronous and uses the
  heads of the last read, so it is at most a minute old. `setup:local` writes anchors
  after its last step, and `bun run anchor:write` does it by hand. A failed write is logged
  by error name and retried at the next read; it never blocks a request. The writer never
  anchors a chain that is shorter than, or different from, its latest anchor: that would
  hide what the anchor is there to show. It logs the refusal once.
- **Verify.** Pure `checkAnchorLog(lines, knownKeys)` checks each line's link and
  signature under the current key, and `anchorVerdict` compares the newest anchor of a
  chain with the database: the anchored `seq` must exist with the same hash, and the
  chain's head must be at or after it. Not OK for a shorter chain (truncation), a
  missing anchored row, a different hash at that seq (rebuild), a bad signature, a removed
  or changed line, an unknown key, a key on disk that is not the key the file ends with,
  and a missing anchors file next to an existing key. The Lab's "Audit chain" and "What
  left this machine" cards show the latest anchor (row and time), the result, the key id
  and the public key, and take the worse status of the chain and its anchor.
  `verify-cli --check` (also with `--chain disclosures`) prints a second line for the
  anchor, reads the anchors file in the state folder by default and takes
  `--anchors <path>` (keys next to it); `--no-anchors` keeps the check of before.
- **Off the machine.** Anchors are never sent anywhere automatically (Peter's decision on
  question 3 below). `bun run anchor:export` prints the newest anchor of each chain and
  the public key so the person can keep them somewhere else (a note, a USB stick, a
  commit in a private repository). _Not built:_ recording when the last export was made.
- **Rotation.** `bun run anchor:rotate` makes a new key and writes a rotation line, signed
  by the old key, that names the new public key; later lines use the new key, and the old
  public key moves to `anchor/retired/<key id>.pub` so old anchors still verify. A lost or
  exposed key: `anchor:rotate -- --without-old-key` removes the old private key, starts a
  new key and writes a rotation line signed by the new key only. The check starts over at
  that line, and the Lab shows it as a break in continuity (Unknown, never OK) for as long
  as the line is in the file.
- **One database per anchors file** (#382, added 2026-11-01). A synthetic install that
  shared the default state folder once wrote its anchors into the file a personal install
  then used, and the personal check failed. Now the first anchor written for a database
  stores a random id in that database (table `anchor_identity`, one row) and writes a
  `kind: "database"` line before it, signed like the others, holding
  `databaseId = SHA-256("twinllm-anchor-database\n" + id)`. It is not secret; it only tells
  two databases apart, and a restored dump keeps it together with the chains it anchors.
  The writer, `anchor:write` and `writeAnchors` refuse to append anchors for another
  database to a file that names one: nothing is written, the server logs
  `[anchor] ANCHOR_DATABASE_MISMATCH: ...` once with both short ids, `anchor:write`
  prints the same and exits 1, and `writeAnchors` throws `AnchorDatabaseMismatch` (code
  `ANCHOR_DATABASE_MISMATCH`). `verify-cli --check` and the Lab cards show Not OK, "anchors
  file is for another database", with both ids; a database whose identity cannot be read
  is Unknown. A second `database` line naming another database fails the file
  (`database-changed`). Files written before #382 have no `database` line: they verify as
  before and take the database's line on their next write, unless a chain does not match
  the file (then it may be another database's file, and nothing is written; the log says
  so once). `.env.synthetic.example` sets its own `TWINLLM_STATE_DIR`, and `setup:local`
  writes `~/.local/share/twin-llm-synthetic` (macOS `TwinLLM-synthetic`), as an absolute
  path, into a new `.env.local`. `TWINLLM_STATE_DIR` must be absolute: `.env` files do not
  expand `~`, so the app refuses a relative value at startup, and `anchor:*` and
  `verify-cli` refuse it too.

**Failure behaviour.** No key: the card says anchors are off and how to create one
(Unknown, not OK). An anchors file or key that cannot be read: Unknown. No anchor yet for
a chain: Unknown. A verification failure: Not OK with the reason, never a silent pass.

**Tests.** `packages/audit/anchor.test.ts`: sign and verify; truncation, rebuild, a
missing anchored row, a removed middle line, a changed line, a bad signature, an unknown
key, a second key line, rotation with and without the old key, an empty chain, the
verdicts and their sentences. `anchor-store.test.ts`: modes `0600` and `0700`, linking
across writes, init refused without the key, a damaged line stops the writer, both
rotations, another database refused with the file untouched, a file from before #382
taking the database on its next write. `infrastructure/anchor-writer.test.ts`: the
interval, the shutdown flush, no anchor over a truncated or rebuilt chain, and the coded
refusal of a second database. `scripts/setup/synthetic-state.test.ts`: the template does
not resolve to or inside the default state folder. The CLI flags and the Lab evidence have
their own tests. Run by hand on a throwaway owner cluster: anchors written, the audit
table truncated, and both `verify-cli --check` and the Lab card reported it
([runbook.md](runbook.md#signed-anchors)).

**Effort.** About 3 days.

## 3. Order of work

| Step | Issue | Depends on                                         | Touches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | #144  | none                                               | `infrastructure/env.ts` (new settings), new `infrastructure/storage-hardening.ts`, `instrumentation.ts`, `scripts/setup/{local,plan,doctor}.ts`, `features/lab/`, `docs/guidelines.md`, `docs/storage.md`, `docs/runbook.md`                                                                                                                                                                                                                                                                                                                                                   |
| 2    | #142  | #144 (state dir, loopback)                         | Built: new `infrastructure/vault*.ts` (key file in the state directory, no migration), `features/vault/`, `app/api/vault/*`, every gated route, page and server action in `tests/personal-reads/personal-reads.test.ts`, the OAuth callbacks, the sidebar and the first-run screens                                                                                                                                                                                                                                                                                            |
| 3    | #141  | #142 (keys)                                        | Built: migration `20261031120000_encrypt_at_rest`, `infrastructure/{field-crypto,field-cipher,personal-columns,reseal,mesh-files,thread-fields}.ts`, every store of the tables in 2.3, `features/search`, `scripts/vault/{migrate,rotate}.ts`, doctor, Lab                                                                                                                                                                                                                                                                                                                     |
| 4    | #145  | #142                                               | Built: migration `20261031130000_learning_consents`, `infrastructure/learning-consent{,-store}.ts`, `features/privacy/`, Customize · Privacy, every pipeline in `tests/learning-consent/pipelines.test.ts`                                                                                                                                                                                                                                                                                                                                                                     |
| 5    | #140  | #141 (value list encrypted)                        | Built: migration `20261031140000_disclosure_ledger`, `packages/audit/{chain,disclosure-chain}.ts`, `infrastructure/disclosure-ledger{,-runtime}.ts`, `resolveLanguageModel` and its callers, `features/wearables/` syncs and the OAuth returns, `features/arena/thread-export-handler.ts`, `features/digital-twin/genome-run.ts`, GBD, search embeddings, PostHog events, `tests/disclosures/`, Lab, Customize · Privacy. #346: the free text check of hosted-model requests (`infrastructure/free-text-check{,-runtime}.ts`, migration `20261031170000_disclosure_free_text`) |
| 6    | #300  | #144 (state dir); covers #140's chain when present | Built: `packages/audit/anchor{,-store,-chains}.ts`, `verify-cli.ts` and its args, `infrastructure/anchor-{writer,runtime}.ts`, `features/lab/anchor-evidence.ts`, `instrumentation.ts`, `scripts/anchor/`, `setup:local`                                                                                                                                                                                                                                                                                                                                                       |

#300 needs only #144 and can run in parallel with steps 2 to 5; it then adds the ledger
chain as a second anchored chain. Customize · Privacy was first planned for #141 (key and
rotation, which became a command); #145 created it with the consent cards, and #140 adds
to it. Each step is its own pull request with its own CHANGELOG
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
3. **Anchors off the machine.** Decided: manual. Anchors stay on the machine and are never
   sent automatically; `anchor:export` prints them for the person to keep elsewhere. An
   automatic copy, such as a commit to a private repository, would be a new outgoing
   channel with its own ledger entry.
