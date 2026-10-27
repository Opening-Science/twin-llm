# Ark adapter

The Ark is a Dark Bio device that keeps the owner's genome on the hardware.
Apps run next to that data; TwinLLM never copies VCF, FASTA, or GFF bytes off
the device. The only bytes that leave are an app report the owner releases
on their phone.

Pinned: **Ark CLI 0.5.0**, **ArkOS firmware 0.13.1 or newer**. CLI 0.5.0 refuses
older firmware with `firmware-outdated` (exit 5); the owner updates it with
`ark firmware update` in a terminal, never from TwinLLM. JSON field additions
are allowed; this adapter uses Zod `looseObject` and pins the tool version here.

Install the CLI from Dark Bio's own release, nothing else:
[github.com/dark-bio/cli/releases](https://github.com/dark-bio/cli/releases).
Each release lists a SHA-256 per file (and macOS users get the same files from
the `dark-bio/tap` Homebrew tap). On Linux, download `ark-0.5.0-linux-amd64`,
check it against the release's digest, and install it user-local, for example
`install -m 755 ark-0.5.0-linux-amd64 ~/.local/bin/ark` (the release's
`ark-installer.sh` does the same). The emulator is
[github.com/dark-bio/emulator](https://github.com/dark-bio/emulator/releases)
0.4.0, which bundles ArkOS 0.13.1.

## What changed with ArkOS 0.13.1 and CLI 0.5.0

- `ark app run FILE` is gone; running an app is `ark run FILE`.
- The genome tree is built around places: `rsids/`, `positions/<chr>/<pos>/`,
  `regions/<chr>/<start>-<end>/` and `genes/<gene>/`, each with `changes/` and
  `copies/`, plus `datasets/<slot>` and `files/<slot>/`. The rsID leaves this
  app reads, `v1/genome/rsids/<rsid>/{chromosome,position,reference,genotype}`,
  are still there; `end` is new.
- Six slots: `reference-genome`, `gene-annotations`, `small-variants`
  (was `snp-indel-calls`), `structural-variants`, `copy-number-variants`,
  `variant-catalog`. `ark data list --json` gives each slot's `build`
  (such as `GRCh38.p14`) and the catalog's dbSNP `version` (such as 157).
- After the update, stored small variants and the variant catalog must be
  added again: `ark data upload calls.vcf.gz` (approved on the phone), then
  `ark data fetch --all` (no approval; the catalog alone takes an hour or more).
- App manifests are TOML, `manifest = 1`, with `[app]`, `[reads]` (`paths` and
  `optional`) and `[output]`. The Ark refuses a misspelled or ungrantable path,
  and a required path whose data is missing, naming it, before the owner is asked.

## TwinLLM wiring

`packages/ark-adapter` spawns `ark <argv> --json` with a fixed argv array (no
shell) via `node:child_process` so it runs under Next's Node runtime.
`GENOME_SOURCE` is `none` by default and refuses to spawn. Set
`GENOME_SOURCE=ark` to allow it. Optional `ARK_DEVICE` is a locator (`hardware:…`,
`emulator:…`, or a serial). Ark data is personal: keep `DATA_MODE=personal`.

Methods: `status()` (works unpaired or locked, and on a self-signed emulator
whose serial and model are null), `doctor()` (check names and results only),
`dataList()` / `dataPaths()` (paired and unlocked; inventories only),
`appRun({ app, grants, timeout })`, which spawns `ark run`. Grants are
audit-only; the Ark mounts what the app's manifest names. TwinLLM never passes
`--unlock`, and never spawns `data upload`, `fetch`, `delete`, `repair`, `pair`,
`unlock` or `firmware`.

Every call appends an audit row (`ark.status`, `ark.doctor`, `ark.data.list`,
`ark.data.paths`, `ark.app.run`) with hashed argv and hashed parsed JSON,
`row_count` 0. The `ark.app.run` row hashes the run's metadata, how many grants
the Ark mounted and the report's length, never the report text or which sites
were mounted: eleven genotypes, or eleven switches, have few enough values that
a hash of them could be reversed.

## Approval, outcomes and concurrency

`ark run` waits on the phone **twice** and blocks throughout; there is no
mid-wait poll:

1. The owner approves the run in Ark Companion within **5 minutes**, seeing the
   app's name, version and every grant, and switches on the optional sites.
2. Once the app ends, the owner reviews the report and releases it within
   **10 minutes**, or declines, which drops it from the Ark.

`--timeout` bounds machine waits, never an approval. The adapter's host cap for
a run is `--timeout` plus both windows plus five minutes, because killing `ark`
cancels the task on the Ark.

| CLI outcome                                | Exit | Adapter state        |
| ------------------------------------------ | ---- | -------------------- |
| released report                            | 0    | `ok`                 |
| `approval-denied` (run or report declined) | 6    | `refused`            |
| `approval-timeout` (a window ran out)      | 6    | `awaiting_approval`  |
| `approval-undelivered`                     | 4    | `undelivered`        |
| `firmware-outdated`                        | 5    | `outdated`           |
| `ark` (the Ark refused the app or a grant) | 5    | `rejected`           |
| `locked`, `not-paired`                     | 5    | `locked`, `unpaired` |
| `device-busy`                              | 3    | `busy`               |
| `app-failed`                               | 8    | `app_failed`         |

Close the Ark Hub browser tab before any CLI command. A second `ark` process or
an open Hub tab returns `device-busy` (exit 3). Run one command at a time.

## What the Connectors card shows

When `GENOME_SOURCE=ark`, the Connectors page calls `GET /api/ark/status` as
the signed-in app actor. The card shows device state, hardware / firmware /
trust, paired and unlocked, the six genome slots as empty or filled, and how
many readable paths the inventory listed (and whether they all sit under
`v1/genome`). It never shows pubkey, identity, path names, or dataset bytes.

When `GENOME_SOURCE=none` the route answers `{ enabled: false }` and the card
stays hidden. Busy, locked, unpaired, outdated and other failures stay 200 with
`state` and `error.code` only. Busy also hints to close the Ark Hub tab;
outdated says "Ark firmware too old: run `ark firmware update`".

## What the Digital Twin genome dashboard shows

When `GENOME_SOURCE=ark` and status is enabled, Digital Twin shows a decorative
helix (no sequence, VCF, or FASTA), the same slot inventory as empty or filled
plus optional build and catalog version, and the last twenty `ark.*` and `genome.*` audit rows
for the signed-in actor as `{ seq, tool, ts, hash8 }`. The audit route never
returns args, result, subject, actor, session, or the full hash. When
`GENOME_SOURCE=none` the page stays on the existing coming-soon placeholder.

With `DATA_MODE=personal` as well, an **rsID genotypes** card runs the app:
**Run on Ark** posts to `/api/genome/run`, which calls `dataList` (for the
small-variants build) and `appRun` with the panel grants. While `ark run`
waits, the card lists both phone steps, **Approve on your phone** (5 minutes)
then **Review and release the report on your phone** (10 minutes). A decline
reads "You declined the run or the report on your phone; nothing was stored."
The released report is parsed strictly, stored as a `GenomeReport` row with the
build `data list` named for small variants, and shown as a table (rsID, gene,
star allele, position, reference, genotype, `no call` or `not granted`); a
reload reads the stored row from `/api/genome/report` instead of asking the Ark
again. What the report feeds next (reference windows, Carbon-X, `/genome`) is
in [genome.md](genome.md).

## Apps

`apps/ark/rsid-genotypes` (0.2.0) is a WASI preview 1 module. Its closed panel
is eleven public CPIC / PharmGKB star-allele defining rsIDs. Its manifest pass
prints:

```toml
manifest = 1

[app]
name = "rsid-genotypes"
version = "0.2.0"

[reads]
paths = ["v1/genome/datasets/small-variants"]
optional = ["v1/genome/rsids/rs4244285", "…eleven sites in report order…"]

[output]
report = "text/markdown"
```

The one required grant is public (the owner never sees it) and makes the Ark
refuse the run until small variants are loaded. Each site is optional, so one
missing site never refuses the run; the owner switches each on at approval.
TwinLLM `appRun` records the eleven site paths as audit grants.

The report pass prints a TSV of recorded fields (`rsid`, `chromosome`,
`position`, `reference`, then the genotype, `no call` or `not granted`) and this
footer:

`Research use only; genotypes as recorded in the loaded call file.`

A site whose directory is not mounted prints `not granted` with empty fields: a
declined optional grant and a site the Ark has no data for look the same to the
app. A missing genotype file is `no call`. Neither is a homozygous-reference
fill. Genotypes print as the Ark serves them (`A/G`, `A|G`, `|A|G`, `./.`, `T/*`,
`<DEL>`); a breakend is refused as unreadable by the parser. Any other I/O error
exits 1 with no report. The app does not interpret genotypes and does not name
a product.

Citation (allele definition tables, 2026-09-28):
https://cpicpgx.org/guidelines/ and
https://www.pharmgkb.org/page/cyp2c19RefMaterials

Synthetic genomes for testing the app and the slot end to end (a VCF for
`small-variants` and the report the app should print for it) are described in
`docs/genome-synthetic.md`.

Build with `bun run ark:build` (wasm stays gitignored; rustup's `cargo` must be
first on `PATH`, since the build needs the `wasm32-wasip1` target). Fixture
goldens: `bun run ark:test`, which also runs the two passes under wasmtime when
it is installed, mounting `optional` grants only where the fixture has them.
Fixtures (`present`, `unanswered`, `declined`, `eio`) follow the 0.13 rsID
layout from Dark Bio's example fixtures and use forward-strand GRCh38
coordinates and alleles; `tests/grch38_panel.rs` checks every panel site
(rsid, chromosome, position, end, reference, alternate) against the panel rows
of `scripts/genome-synth/variants.tsv`. The app prints whatever the Ark reports,
so on a real run the device's own variant catalog is authoritative. A live
`appRun` is `RUN_ARK=1` after that build and both phone steps. Close Hub first.
The Digital Twin card runs the module at
`apps/ark/rsid-genotypes/build/rsid-genotypes.wasm` unless
`ARK_RSID_GENOTYPES_WASM` names another path.

## Emulator

Ark Emulator 0.4.0 (ArkOS 0.13.1) runs headless on Linux with KVM:

```sh
ark-emulator start --headless --json   # prints the locator, e.g. emulator:18181
ark --device emulator:18181 status --json
ark --device emulator:18181 doctor --json
ark-emulator stop
```

A fresh emulator is self-signed: `ark status` reports `trust: self-signed` with
serial, model, environment and realm null. Before any data or app command it
must be enrolled at Ark Hub in a browser (`ark enroll` prints the address), then
paired with Ark Companion (`ark pair`), then unlocked on the phone. It is then
filled from a public 1000 Genomes sample, never a person's own calls:
`ark data samples --all` (pick one at random), `ark data fetch --sample NAME`
(three phone approvals), `ark data fetch --all`.

Tested on 2026-10-27 with CLI 0.5.0 and emulator 0.4.0 on Linux: `ark-emulator
doctor`, `ark-emulator start --headless`, `ark devices`, `ark status`,
`ark doctor`, `ark enroll` (prints the Hub address, exit 1
`enrollment-required`), and `ark data list` / `ark data paths` (exit 5
`not-paired`). The adapter fixtures `status-emulator-unenrolled.json` and
`doctor-emulator.json` are those documents, with the identity replaced. Enrolling,
pairing, filling a sample and `ark run` need a browser sign-in and a phone, so
they were not run; the rsID layout comes from the 0.5.0 manual and Dark Bio's
published example fixtures, and from a structure-only check on hardware.

## Operations

See `docs/runbook.md` for `bun test packages/ark-adapter` and the local-only
`RUN_ARK=1` smoke (close Hub, one command at a time).
