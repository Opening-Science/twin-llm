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
                                         ark data list   (small-variants build) ─────▶ slots
                                         ark run rsid-genotypes.wasm ─────────────▶ app reads
                                         … blocks …                                  v1/genome/rsids/*
 "Approve on your phone" (5 min)                               owner approves, switches sites on
 "Review and release the report" (10 min)                      owner releases the report
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
5. **Ark report requests need all of:** `DATA_MODE=personal`, `GENOME_SOURCE=ark`,
   `LLM_PROVIDER=ollama` with Ollama on loopback, and the local Carbon-X
   (`permitGenomeRequest` in `infrastructure/data-mode-policy.ts`). Otherwise
   `genome_report` and `dna_ask` are not on the turn at all, and they refuse again
   if called in a synthetic scope. `genome_variants` over an imported VCF needs
   only the first and third (`permitVcfVariantsRequest`, #330; see
   [Imported VCF](#imported-vcf)).
6. **No genotype goes to a hosted provider**, the consented Exoscale pilot
   included, nor to OpenRouter, the remote GPU, Infomaniak, GBD or any MCP
   server. The rule holds per thread, not only per question: a thread where
   `genome_report`, `dna_ask` or `genome_variants` ran (a stored tool part or
   a genome audit row), or whose history shows a `/genome` prompt or a Carbon-X answer, is
   genome-personal. Every later turn in it runs only on Ollama on loopback;
   any other model is refused before the history is sent, the answer is
   stored as refused with "This thread used your genome report or imported
   data, so it only runs on local models.", and `genome.thread.refused` is audited with the
   provider and a SHA-256 of the thread id. A second check just before the
   history goes to a model refuses again if a genome thread got that far
   (`infrastructure/genome-thread-policy.ts`). An export of a genome-personal
   thread (`/report`, #44, not built yet) must use `permitGenomeThreadExport`
   and goes only to a recipient on this machine. Starting a new thread is the
   way to use a hosted model again. A thread where an imported-data tool
   ran (#181, `docs/query-layer.md`) is held to the same rule. An incognito chat
   ([chat-platform.md](chat-platform.md#incognito-chats)) runs only on Ollama
   on loopback and stores no thread, so the genome tools may run in it under
   the same policy, its answers and tool results are never stored, and its
   genome audit rows carry a random session id instead of a turn id. The genome tools are left out of the eval
   harness. `genome_report` and `dna_ask` are left out of the MCP manifest;
   `genome_variants` is listed there only so a client learns that it always
   refuses (`GENOME_NOT_PERMITTED`), as the imported-data tools do. Training data offers them only with `--genome`, on synthetic
   genomes with stand-in answers, never a person's report
   (`docs/genome-synthetic.md`). Analytics send nothing in personal mode.
7. **Every step is audited, without genotypes.** `ark.data.list`, `ark.app.run`,
   `genome.report.store`, `genome.report`, `genome.dna_ask` and
   `genome.variants` each append to the hash chain. Their arguments and results hold rsIDs, ids, counts and
   outcome codes only: no genotype, no report text, no answer, and no hash of
   any of them. `genome.variants` keeps only how many names were asked and how
   many were found (or the refusal code), not even the rsIDs. A genotype has so few possible values that a plain hash could
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
Ark's `data list --json` (the `small-variants` slot's `build`, such as
`GRCh38` or `GRCh38.p14`, else `reference-genome`'s), stored with the report.
On ArkOS 0.13.1 the slot names its build, so `GENOME_ASSUME_BUILD` is only for
an Ark that names none:

| Ark names        | Result                                                  |
| ---------------- | ------------------------------------------------------- |
| `GRCh38`, `hg38` | Windows built                                           |
| `GRCh37`, `hg19` | Refused (`BUILD_MISMATCH`), even with an assumption set |
| another build    | Refused (`BUILD_UNKNOWN`)                               |
| nothing          | Refused, unless `GENOME_ASSUME_BUILD=GRCh38` is set     |

Independently, the reference allele in the report must equal the FASTA base at
that position. A mismatch refuses (`REF_MISMATCH`); a reverse-complement match
refuses as `REF_STRAND_MISMATCH`, because the call file is on the other strand.

## Imported VCF

A person can also import their own VCF on Customize · Data (#180,
[personal-data.md](personal-data.md#genome-vcf)). The same build rules apply, from
the file's header: GRCh38 or hg38 is read, GRCh37 or hg19 is refused as
`BUILD_MISMATCH`, another build as `BUILD_UNKNOWN`, and a file that names none is
refused unless `GENOME_ASSUME_BUILD=GRCh38` is set. The variants are stored in
`personal_variants`, read only by a model on this machine under
`permitVcfVariantsRequest`, never by the imported-data chat tools, and audited with counts
only (no genotype, position, rsID or hash of the file).

`genome_variants({ dataset_id, variants })` (#307) is the one chat tool that reads
them. It looks up named variants only: each name is an rsID (`rs4244285`) or one
GRCh38 site written `chrN:pos` (`chr10:94781859`, `chrX`, `chrY` and `chrM` too), at
most 50 per call. There is no range, gene, wildcard or "all variants", so the model
cannot scan the file. For each distinct name it returns `found` and the matching
records as the file wrote them: `chrom`, `pos`, `id`, `ref`, `alt`, `genotype` (GT,
such as `0/1`), `alleles` (the same GT in bases, such as `C/T`, null for a no-call)
and `filter`. A site matches a file that writes `chr1` or `1`; an rsID matches a
whole ID, also one of several joined by `;`. Not found means the file has no record
there, which is not the same as the reference allele, and the result says so.

- **Policy.** An imported VCF and a local model are enough (#330). The tool is on a
  turn only when `permitVcfVariantsRequest` holds: `DATA_MODE=personal` and
  `LLM_PROVIDER=ollama` with Ollama on loopback. It needs no `GENOME_SOURCE=ark` and
  no Carbon-X, which serve `genome_report` and `dna_ask` only, and those two keep
  `permitGenomeRequest`. It asks the permit again on every call before any read. A
  hosted provider (the consented Exoscale pilot included), Ollama on another machine
  and synthetic mode are refused with `GENOME_NOT_PERMITTED` and a `reason`
  (`chat-model-not-local` or `data-mode-not-personal`). Over MCP it always refuses
  with that code. The Customize source `vcf-variants` is usable whenever this permit
  holds; without it, it reads "Personal mode and a local model only".
- **Coded refusals.** `DATASET_NOT_FOUND` (not one of the person's datasets; it lists
  the person's VCFs as `vcf_datasets`, id, name and variant count, so the model can
  pick one), `NOT_A_VCF_DATASET` (another kind of import), `TOO_MANY_VARIANTS` (more
  than 50 names; refused, not cut), `MALFORMED_VARIANT_NAMES` (lists up to 10 of the
  names it could not read; nothing is read) and `ROW_CAP_EXCEEDED` (more than 200
  matching records).
- **Audit.** One `genome.variants` row per call, refusal or throw: `{ requested }` and
  `{ found }` or the refusal code. No name, position, genotype or dataset name.
- **Threads.** A thread where it ran is genome-personal and stays on local models,
  as above.
- **Source.** `vcf-variants` ("Variants in your imported VCF") in the genome group;
  the `/genome` skill lists it for a named variant outside the Ark report.

## Setup

1. Ark: see [ark.md](ark.md). Ark CLI 0.5.0 needs ArkOS 0.13.1 or newer. After
   the 0.13 update, add the owner's small variants again with
   `ark data upload calls.vcf.gz` (approved on the phone), then
   `ark data fetch --all` for the references and the variant catalog.
   Build the app with `bun run ark:build` (rustup's `cargo` first on `PATH`),
   close the Ark Hub tab, and set

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

4. Open Digital Twin and press **Run on Ark**. Approve the run on your phone
   within 5 minutes and switch on the sites you want read, then review and
   release the report within 10 minutes. The table shows each site's gene, star
   allele, position, reference and genotype, `no call`, or `not granted` for a
   site you left off (or one the Ark has no data for). It is stored, so a reload
   does not ask the Ark again; **Run again** releases a fresh report.

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
| Synthetic reports (testing)  | `scripts/genome-synth/`, `docs/genome-synthetic.md`           |
| Reference windows and build  | `packages/genome-reference/`                                  |
| Carbon-X client and prompt   | `packages/carbon-x/`                                          |
| Chat tools                   | `features/chat/genome-tools.ts`                               |
| Policy                       | `permitGenomeRequest`, `infrastructure/genome-gate.ts`        |
| VCF policy (#330)            | `permitVcfVariantsRequest`, `vcfVariantsChatPermit`           |
| Thread rule (#151)           | `infrastructure/genome-thread-policy.ts`, `start-answer.ts`   |
| Skill                        | `skills/genome/`                                              |
| Imported VCF (#180)          | `packages/personal-data/parse-vcf.ts`, `vcf-build.ts`         |
| Variant lookup tool (#307)   | `packages/query-tools/imported-variant*.ts`                   |

Tests need no hardware and no GPU: the Ark CLI is replaced through the
adapter's spawn hook and fixture JSON, the report through the app's goldens,
the reference through a 200-base synthetic `chr10.fa`, and Carbon-X through a
fake server on `127.0.0.1` (`packages/carbon-x/fake-carbon-x.ts`).
