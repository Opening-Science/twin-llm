# Genome track: Ark report to Carbon-X

The genome track lets an Ark owner run the `rsid-genotypes` app on their device,
keep the report they release on this machine, and ask Carbon-X, a local DNA
research model, about one variant at a time. Issue #105, research track #58.
Device details: [ark.md](ark.md). Research use only; nothing here is clinical
advice.

## Flow

```text
 Digital Twin page                     this machine                         Ark device
 ─────────────────                     ────────────                         ──────────
 [Run on Ark] ── POST /api/genome/run ─▶ packages/ark-adapter
                                         ark data list   (build of the call slot) ─▶ slots
                                         ark app run rsid-genotypes.wasm ─────────▶ app reads
                                         … blocks …                                  v1/genome/rsids/*
 "Approve on your phone"                                       owner approves in Companion app
                                         ◀──────────── released TSV (rsid, chr, pos, ref, genotype)
                                         strict parse (11 rows, footer)
                                         GenomeReport row (Postgres, personal)
 table: rsID, gene, allele, genotype ◀── audit genome.report.store (counts only)

 Chat (/genome or a question) ── local Ollama model
                                   genome_report ─▶ stored report
                                   dna_ask({rsid}) ─▶ stored row (genotype)
                                                    build check (GRCh38 only)
                                                    GENOME_REFERENCE_DIR (public GRCh38 FASTA)
                                                      ref allele must match, else refuse
                                                      ref window ± 256 bp, alt window
                                                    POST 127.0.0.1:8090/v1/chat/completions
                                                      model carbon-x, DNA inside <dna>…</dna>
                                                    dosing sentences withheld
                                   ◀─ "Carbon-X (research model)" answer
                                   audit genome.dna_ask (rsID, report id, outcome)
```

## Privacy rules

These are enforced in code, not only by convention.

1. **Genome data never leaves the machine.** The Ark keeps the genome. The only
   bytes TwinLLM ever receives are the app report the owner releases after a
   phone approval, and that report is stored in the local Postgres only.
2. **Only the approved report is used:** rsID, chromosome, position, reference
   allele and genotype (or `no call`) for the eleven panel sites. Nothing else
   is read from the device.
3. **DNA sequence context is public.** The windows sent to Carbon-X come from
   the public GRCh38 reference in `GENOME_REFERENCE_DIR`, never from the
   device. The only personal part of a Carbon-X prompt is the recorded genotype,
   which picks the alternate allele.
4. **Carbon-X is local only.** `CARBON_X_URL` must be loopback
   (`127.0.0.1`, `localhost` or `[::1]`); any other value stops the boot, and
   the client refuses again before each request.
5. **Genome requests need all of:** `DATA_MODE=personal`, `GENOME_SOURCE=ark`,
   `LLM_PROVIDER=ollama` with Ollama on loopback, and the local Carbon-X
   (`permitGenomeRequest` in `infrastructure/data-mode-policy.ts`). Otherwise
   the genome tools are not on the turn at all, and they refuse again if called
   in a synthetic scope.
6. **No genotype goes to a hosted provider**, the consented Exoscale pilot
   included, nor to OpenRouter, the remote GPU, Infomaniak, GBD or any MCP
   server. The genome tools are left out of the eval harness, the training
   data and the MCP manifest. Analytics send nothing in personal mode.
7. **Every step is audited, without genotypes.** `ark.data.list`, `ark.app.run`,
   `genome.report.store`, `genome.report` and `genome.dna_ask` each append to
   the hash chain. Their arguments and results hold rsIDs, ids, counts and
   outcome codes only: no genotype, no report text, no answer, and no hash of
   any of them. A genotype has so few possible values that a plain hash could
   be reversed by trying them all, so the `ark.app.run` row keeps the report's
   length instead of its text.
8. **Carbon-X is research only.** Every answer is labelled
   "Carbon-X (research model)". Its system message asks for a description of
   what the variant is known to affect; any sentence about doses or about
   starting, stopping or changing a medicine is withheld before anyone reads
   it. The panel sites are pharmacogenomic: TwinLLM describes, it never doses.

## Build mismatch

The report's positions must be on GRCh38, the build of the reference windows.
A GRCh37 (hg19) position points at different bases. The build comes from the
Ark's `data list` (the `snp-indel-calls` slot, else `reference-genome`):

| Ark names        | Result                                                  |
| ---------------- | ------------------------------------------------------- |
| `GRCh38`, `hg38` | Windows built                                           |
| `GRCh37`, `hg19` | Refused (`BUILD_MISMATCH`), even with an assumption set |
| another build    | Refused (`BUILD_UNKNOWN`)                               |
| nothing          | Refused, unless `GENOME_ASSUME_BUILD=GRCh38` is set     |

Independently, the reference allele in the report must equal the FASTA base at
that position. A mismatch refuses (`REF_MISMATCH`); a reverse-complement match
refuses as `REF_STRAND_MISMATCH`, because the call file is on the other strand.

## Setup

1. Ark: see [ark.md](ark.md). Build the app with `bun run ark:build`, close the
   Ark Hub tab, and set

   ```sh
   DATA_MODE=personal
   GENOME_SOURCE=ark
   ARK_DEVICE=alpha-002        # optional locator
   LOCAL_ONLY=true
   LLM_PROVIDER=ollama
   ```

2. Public reference: the UCSC hg38 per-chromosome FASTA. The panel needs
   chr1, chr6, chr10, chr12, chr16 and chr22. If `~/Projects/carbon-x/ref`
   already holds them (its `fetch_refs.sh` downloads the same files), point
   `GENOME_REFERENCE_DIR` there instead of downloading again.

   ```sh
   mkdir -p ~/genome/grch38 && cd ~/genome/grch38
   UCSC=https://hgdownload.soe.ucsc.edu/goldenPath/hg38/chromosomes
   curl -fsSO "$UCSC/md5sum.txt"
   for c in chr1 chr6 chr10 chr12 chr16 chr22; do curl -fsSO "$UCSC/$c.fa.gz"; done
   grep -E ' (chr1|chr6|chr10|chr12|chr16|chr22)\.fa\.gz$' md5sum.txt | md5sum -c -
   # optional, faster reads: gunzip -k chr*.fa.gz
   ```

   Then `GENOME_REFERENCE_DIR=~/genome/grch38` (an absolute path). Plain `.fa`
   files are read at an offset; `.fa.gz` (gzip or bgzip) is decompressed as a
   stream, about a second for a site 100 Mb into chr1.

3. Carbon-X sidecar on this machine, OpenAI-compatible:
   `GET http://127.0.0.1:8090/health` and
   `POST http://127.0.0.1:8090/v1/chat/completions` with `model: "carbon-x"`.
   Set `CARBON_X_URL` only if it listens elsewhere on loopback
   (default `http://127.0.0.1:8090/v1`); `CARBON_X_TIMEOUT_S` defaults to 120.

4. Open Digital Twin, press **Run on Ark**, approve on your phone. The table
   shows each site's gene, star allele, position, reference and genotype or
   `no call`. It is stored, so a reload does not ask the Ark again; **Run
   again** releases a fresh report.

5. In chat, `/genome` summarises the report and asks Carbon-X about each called
   site. The `Released Ark report and Carbon-X` source can be turned off at
   `/start`.

## Code

| Part                         | Where                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| Panel, grants, report parser | `packages/ark-adapter/rsid-genotypes.ts`                      |
| Run and stored report routes | `features/digital-twin/genome-run.ts`, `app/api/genome/*`     |
| Dashboard card               | `features/digital-twin/genome-report.tsx`                     |
| Stored report                | `GenomeReport` model, `infrastructure/genome-report-store.ts` |
| Reference windows and build  | `packages/genome-reference/`                                  |
| Carbon-X client and prompt   | `packages/carbon-x/`                                          |
| Chat tools                   | `features/chat/genome-tools.ts`                               |
| Policy                       | `permitGenomeRequest`, `infrastructure/genome-gate.ts`        |
| Skill                        | `skills/genome/`                                              |

Tests need no hardware and no GPU: the Ark CLI is replaced through the
adapter's spawn hook and fixture JSON, the report through the app's goldens,
the reference through a 200-base synthetic `chr10.fa`, and Carbon-X through a
fake server on `127.0.0.1` (`packages/carbon-x/fake-carbon-x.ts`).
