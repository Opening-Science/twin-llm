# Ark adapter

The Ark is a Dark Bio device that keeps the owner's genome on the hardware.
Apps run next to that data; TwinLLM never copies VCF, FASTA, or GFF bytes off
the device. The only bytes that leave are an app report the owner releases
after a phone approval.

Pinned CLI: **0.3.5** (firmware seen on hardware: 0.11.6). JSON field additions
are allowed; this adapter uses Zod `looseObject` and pins the tool version here.

## CLI today vs Ark Hub

| Surface       | Genome                                                                                                                               | Lab / bloodwork                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Ark CLI 0.3.5 | Four slots (`reference-genome`, `gene-annotations`, `snp-indel-calls`, `variant-catalog`). All 53 data paths start with `v1/genome`. | Not present                             |
| Ark Hub       | Same genome slots in the browser UI                                                                                                  | Hub exposes bloodwork; the CLI does not |

Observation and lab slots on the CLI are a Dark Bio ask, not something TwinLLM
can invent. Until that exists, wearables and lab FHIR stay in the local
Postgres warehouse (`docs/storage.md`).

## TwinLLM wiring

`packages/ark-adapter` spawns `ark <argv> --json` with a fixed argv array (no
shell) via `node:child_process` so it runs under Next's Node runtime.
`GENOME_SOURCE` is `none` by default and refuses to spawn. Set
`GENOME_SOURCE=ark` to allow it. Optional `ARK_DEVICE` is a locator (`hardware:…`,
`emulator:…`, or a serial). Ark data is personal: keep `DATA_MODE=personal`.

Methods: `status()` (works unpaired or locked), `dataList()` / `dataPaths()`
(paired and unlocked; inventories only), `appRun({ app, grants, timeout })`.
Grants are audit-only; Ark mounts the app manifest `datasets`. TwinLLM never
passes `--unlock`.

Every call appends an audit row (`ark.status`, `ark.data.list`, `ark.data.paths`,
`ark.app.run`) with hashed argv and hashed parsed JSON, `row_count` 0. The
`ark.app.run` row hashes the run's metadata and the report's length, never the
report text: eleven genotypes have few enough values that a hash of them could
be reversed.

## Approval and concurrency

Phone approval is **blocking**. The CLI waits until the Companion app answers;
there is no mid-wait poll. `--timeout` bounds machine and network waits, not
approval (plan on about a minute). `approval-denied` maps to `refused`;
`approval-timeout` maps to `awaiting_approval` only after the process exits.

Close the Ark Hub browser tab before any CLI command. A second `ark` process or
an open Hub tab returns `device-busy` (exit 3). Run one command at a time.

## What the Connectors card shows

When `GENOME_SOURCE=ark`, the Connectors page calls `GET /api/ark/status` as
the signed-in app actor. The card shows device state, hardware / firmware /
trust, paired and unlocked, the four genome slots as empty or filled, and how
many readable paths the inventory listed (and whether they all sit under
`v1/genome`). It never shows pubkey, identity, path names, or dataset bytes.

When `GENOME_SOURCE=none` the route answers `{ enabled: false }` and the card
stays hidden. Busy, locked, unpaired, and other failures stay 200 with `state`
and `error.code` only. Busy also hints to close the Ark Hub tab.

## What the Digital Twin genome dashboard shows

When `GENOME_SOURCE=ark` and status is enabled, Digital Twin shows a decorative
helix (no sequence, VCF, or FASTA), the same slot inventory as empty or filled
plus optional build and catalog version, and the last twenty `ark.*` and `genome.*` audit rows
for the signed-in actor as `{ seq, tool, ts, hash8 }`. The audit route never
returns args, result, subject, actor, session, or the full hash. When
`GENOME_SOURCE=none` the page stays on the existing coming-soon placeholder.

With `DATA_MODE=personal` as well, an **rsID genotypes** card runs the app:
**Run on Ark** posts to `/api/genome/run`, which calls `dataList` (for the
build) and `appRun` with the panel grants. While the CLI waits, the card shows
**Approve on your phone**. The released report is parsed strictly, stored as a
`GenomeReport` row and shown as a table (rsID, gene, star allele, position,
reference, genotype or `no call`); a reload reads the stored row from
`/api/genome/report` instead of asking the Ark again. What the report feeds
next (reference windows, Carbon-X, `/genome`) is in [genome.md](genome.md).

## Apps

`apps/ark/rsid-genotypes` is a WASI preview 1 module. Its closed panel is eleven
public CPIC / PharmGKB star-allele defining rsIDs. Manifest `datasets` lists
`v1/genome/rsids/<rsid>` for each site, matching `ark data paths` (keep the
`v1/` prefix, no trailing slash). TwinLLM `appRun` passes that same list as
audit grants. Ark mounts the manifest datasets; grants are not CLI flags.

The run pass prints a TSV of recorded fields (`rsid`, `chromosome`, `position`,
`reference`, `genotype` or `no call`) and this footer:

`Research use only; genotypes as recorded in the loaded call file.`

A missing genotype file is `no call`. That is not a homozygous-reference fill.
Any other I/O error exits 1 with no report. The app does not interpret
genotypes and does not name a product.

Citation (allele definition tables, 2026-09-28):
https://cpicpgx.org/guidelines/ and
https://www.pharmgkb.org/page/cyp2c19RefMaterials

Synthetic genomes for testing the app and the slot end to end (a VCF for
`snp-indel-calls` and the report the app should print for it) are described in
`docs/genome-synthetic.md`.

Build with `bun run ark:build` (wasm stays gitignored). Fixture goldens:
`bun run ark:test`. Fixtures and goldens are synthetic and use forward-strand
GRCh38 coordinates and alleles; `tests/grch38_panel.rs` checks every panel site
(rsid, chromosome, position, reference, alternate) against the panel rows of
`scripts/genome-synth/variants.tsv`. The app prints whatever the Ark reports,
so on a real run the device's own variant catalog is authoritative. A live `appRun` is `RUN_ARK=1` after that build and a
Companion approval. Close Hub first. The Digital Twin card runs the module at
`apps/ark/rsid-genotypes/build/rsid-genotypes.wasm` unless
`ARK_RSID_GENOTYPES_WASM` names another path.

## Operations

See `docs/runbook.md` for `bun test packages/ark-adapter` and the local-only
`RUN_ARK=1` smoke (close Hub, one command at a time).
