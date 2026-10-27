# Synthetic genomes

The genome track (an Ark report, the genome bridge, Carbon-X through `dna_ask`)
needs genotypes to build, test and train on, and no real genome may be used for
that. `scripts/genome-synth` makes synthetic ones: seeded genotypes for synthetic
subjects at a fixed set of public variant sites, written as the Ark app's report
and as a small VCF. Nothing it writes describes a real person.

## What is generated

For one synthetic `subject_ref` (a Synthea Patient id) and the catalog version
`genome-synth-v1`:

- **Genotypes** at 92 sites: the eleven sites of the Ark `rsid-genotypes` panel and
  81 curated public variants (37 more pharmacogenomic sites, 13 ClinVar pathogenic
  and 10 ClinVar benign examples, 21 trait SNPs). All are single-base
  substitutions on the autosomes; sex chromosomes are left out, so no site depends on
  a subject's sex.
- **The report** (`<ref>.rsid-genotypes.tsv`): byte for byte what
  `apps/ark/rsid-genotypes` prints for that subject's VCF, as if the owner had
  released it from the device: title, one line per panel site
  (`rsid chromosome position reference genotype`), the research-use footer. A
  no-call prints `no call`.
- **The VCF** (`<ref>.vcf`): VCF 4.2, GRCh38 with `chr` contig names and lengths, one
  sample named `SYNTHETIC_<first block of the ref>`, a record for every catalog site
  (`0/0` included, `./.` for a no-call), the rsID in `ID`, and `GENE`, `POP_AF` and a
  `SYNTHETIC` flag in `INFO`. The header has `##source=TwinLLM-synthetic` and a
  `##TwinLLM_note` line that starts `SYNTHETIC - not a real person`. Meta lines are
  plain ASCII (a hyphen, not a dash) so that no VCF 4.2 reader trips on them.

```sh
bun run genome:synth -- --subject 080b069b-5108-46b6-ecef-6aacd3b9ef3f            # data/genome-synth/subjects/
bun run genome:synth -- --subject <ref>,<ref> --out <dir>
bun run genome:ingest -- --in .synthea/synthea-v4-seed4242/fhir                    # data/genome-synth/<cohort>.reports.jsonl
bun run genome:ingest -- --in .synthea/fhir --cohort synthea-v4-seed42 --out <file>
```

`genome:synth` takes UUID-shaped subject_refs only. `genome:ingest` reads a Synthea
FHIR folder (the Patient id is the subject_ref; hospital and practitioner files are
skipped), takes the cohort id from `manifest.json` next to the folder or from
`--cohort`, and refuses a cohort that is not on the synthetic allowlist. Both print
counts only. `data/genome-synth/` is gitignored.

### Released reports for the cohorts

`genome:ingest` writes one JSON line per subject, sorted by subject_ref:

```json
{
  "subject_ref": "…",
  "cohort_id": "synthea-v4-seed4242",
  "app": "rsid-genotypes",
  "app_version": "0.1.0",
  "catalog_version": "genome-synth-v1",
  "report": "# rsID genotypes\n\n…",
  "report_sha256": "…",
  "synthetic": true
}
```

`report` is the string the Ark returns for an approved app run (`{ report }` in
`packages/ark-adapter`); the other fields say whose report it is and where it came
from. By default the command writes this file and touches no database.

### Into the database (`--to-db`)

```sh
bun run genome:ingest:db -- --in .synthea/synthea-v4-seed4242/fhir   # reads .env.training
```

With `--to-db` each report goes into `genome_reports`, the table the genome bridge
(#107) stores a released device report in, through
`replaceSyntheticGenomeReport` (`infrastructure/genome-report-store.ts`). The row has
the same fields a device report gets (`app`, `arkBuild` `GRCh38`, the parsed `rows`
from `parseRsidGenotypesReport`, the exact `report` text), with `isSynthetic` true and
`subjectRef` set instead of `userId`:

- A CHECK constraint allows exactly one owner: a user's own report
  (`isSynthetic` false, `userId` set) or a synthetic subject's (`isSynthetic` true,
  `subjectRef` set, no user). `latestGenomeReport`, which the chat tools and the
  dashboard read, also asks for `isSynthetic` false.
- `subjectRef` is a foreign key to the warehouse `subjects` table, so the subject
  must already be ingested; a subject that is not there is skipped and counted. A
  subject that is not synthetic, or belongs to another cohort, is refused and the run
  exits 1. Deleting a cohort's subjects (`training:batches` does) deletes their
  genome reports with them.
- It runs only with `DATA_MODE=synthetic` and an allowlisted cohort, so the Self
  subject and a person's own report are never touched. A re-run replaces each
  subject's synthetic report instead of adding one.

## Determinism

Each site draws from its own seeded stream, keyed by the catalog version, the
subject_ref and the rsID (FNV-1a into mulberry32, the generator the synthetic
wearables use). The same subject and catalog version give the same genotypes, report
and VCF on every machine; adding a site does not change any other site. The cohort
seed is not part of the key, so a subject keeps its genome in every cohort run that
includes it. `vcf.test.ts` pins the SHA-256 of subject 080b069b's VCF, so a change
that would alter every synthetic genome fails a test.

A site is a no-call with probability 0.02. Otherwise the genotype follows
Hardy–Weinberg proportions for the catalog's alternate allele frequency q:
(1 − q)² homozygous reference, 2q(1 − q) heterozygous, q² homozygous alternate.
Frequencies are global (all samples), so the genotypes resemble no particular
ancestry, and there is no linkage between sites: two sites in one gene are drawn
independently, which real haplotypes are not.

## Sources and licences

The catalog is `scripts/genome-synth/variants.tsv`. Its header names every source;
`bun scripts/genome-synth/refresh-catalog.ts` re-reads them (it prints the
difference, and `--write` rewrites the file). Retrieved 2026-10-27 from the Ensembl
REST API, release 116.

| Column                 | Source                                                                              | Licence                                       |
| ---------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `rsid`, `chrom`, `pos` | dbSNP build 156, GRCh38 mapping via Ensembl                                         | NCBI: public domain; Ensembl: no restrictions |
| `ref`                  | Ensembl allele string, checked against the GRCh38 base at that position             | as above                                      |
| `alt`, `alt_af`        | Most frequent non-reference allele in gnomAD genomes (`gnomADg:ALL`)                | gnomAD: CC0 1.0 (attribution requested)       |
| `consequence`          | Ensembl's most severe Sequence Ontology consequence                                 | Ensembl: no restrictions                      |
| `clinvar`              | ClinVar clinical significance as imported by Ensembl (ClinVar 09/2025)              | NCBI: public domain (citation requested)      |
| `category`, `gene`     | Curated here; genes checked against Ensembl VEP                                     | Apache-2.0 (this repository)                  |
| `note`                 | Short labels written here; CPIC allele definition tables and PharmGKB variant pages | CPIC: CC0 1.0; no PharmGKB text is copied     |

Only identifiers, positions, alleles and allele frequencies as plain numbers are
used: no individual-level data, no annotation text. The refresh script falls back to
1000 Genomes phase 3 (free to use without restriction) where gnomAD has no
frequency; for `genome-synth-v1` every site has a gnomAD genomes frequency.

**The Ark app's own fixtures disagree with GRCh38 at four panel sites.** The catalog
follows Ensembl: rs4986893 is at chr10:94780653 (the fixture has 94762706, which is
rs28399504, CYP2C19\*4), rs3918290 at chr1:97450058 (fixture 97515839), and
rs1142345 (T>C) and rs9923231 (C>T) are written on the forward strand (the fixtures
have the gene-strand A and G). The fixtures are test data for the app's formatter
and are unchanged here; a real device prints what its loaded data says.

## Loading the VCF onto an Ark

This has not been run against a device. It follows `docs/ark.md` and the adapter.
TwinLLM never uploads or deletes Ark data: `packages/ark-adapter` refuses
`data upload` and `data delete`, so these are the owner's own commands.

1. Make the file: `bun run genome:synth -- --subject <ref> --out <dir>`. Keep the
   `.rsid-genotypes.tsv` next to it; it is the report the device should print.
2. Close the Ark Hub tab. Run one `ark` command at a time.
3. Check the device: `ark status --json` and `ark data list --json` (CLI 0.5.0,
   ArkOS 0.13.1). The `small-variants` slot (id 3) should be empty. If it holds
   the owner's real calls, stop: do not replace a real genome with a synthetic
   one. An emulator is the safer place for this.
4. Load the file: `ark data upload calls.vcf.gz --slot small-variants`, approved
   on the phone, then `ark data fetch --all` for the references and catalog.
5. `ark data list --json`: `small-variants` filled, with its `build`.
   `ark data paths --json`: `v1/genome/rsids/<rsid>` should be `available`.
6. Build and run the app: `bun run ark:build`, then the local smoke test
   (`GENOME_SOURCE=ark RUN_ARK=1 ARK_DEVICE=<locator> bun test packages/ark-adapter`,
   `docs/runbook.md`) or `ark run apps/ark/rsid-genotypes/build/rsid-genotypes.wasm`.
   Approve the run on the phone with all eleven sites switched on, then release
   the report.
7. Compare the report the device prints with the saved `.rsid-genotypes.tsv`
   (`diff`). They should match byte for byte.
8. When done, empty the slot in Ark Hub (or `ark data delete 3`), so the synthetic
   genome is not mistaken for the owner's.

Things the device may do differently, each worth writing down if it happens:

- The rsID paths may need the `variant-catalog` slot to map positions to rsIDs. The
  VCF carries rsIDs in `ID`, but if step 5 lists no `rsids` paths, the device maps
  them another way.
- A `./.` record may come out as `no call` (as the app prints a missing genotype
  file) or the device may drop the record; both print `no call`. The saved report
  expects `no call` for a no-call site.
- The device may want a compressed `.vcf.gz` (BGZF). The file here is plain text;
  `bgzip` (htslib) compresses it if needed.
- The device may write a heterozygous genotype as `alt/ref` (the app's own fixture
  has `A/G` at rs4244285). The saved report writes the reference allele first.

## Training conversations

`bun run training:conversations -- --cohort <id> --genome` adds seven genome
families (`docs/training-data.md`) that use the chat's genome tools from #107,
`genome_report` and `dna_ask({ rsid })`, with their real definitions: one or two
report sites, a no-call site, a site that is not in the report, a dose question
(`REFUSE:`), another person's genome and a request to send the genome to a hosted
provider. The real Carbon-X output is not available in CI, so a `dna_ask` result has
the real tool's shape but its `answer` is a fixed text built from the catalog row
(gene, consequence, ClinVar significance), and its `source` reads `Synthetic stand-in
for Carbon-X (research model): training data, not model output`. Without `--genome` a
run is byte-for-byte what it was.

## Privacy

- Synthetic only. Do not run these scripts on, or mix their output with, a real
  person's genome, report or VCF. The generator reads only the committed catalog and
  synthetic subject_refs; `genome:ingest` reads only Synthea bundles.
- The VCF and reports are marked synthetic in every file, but a VCF looks like a real
  one once copied elsewhere. Keep generated files under `data/genome-synth/` or
  another gitignored folder, and delete a synthetic genome from a device after the
  test.
- A synthetic genome is a random draw from public frequencies. It is not an estimate
  of anyone's genome, and a match with a real person at a few common sites is
  chance.
