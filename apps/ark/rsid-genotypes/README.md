# rsid-genotypes

Ark WASI app: a closed panel of public CPIC / PharmGKB star-allele defining
rsIDs. It prints recorded genotypes only. It does not interpret them and it
does not name a product.

Citation (allele definition tables, 2026-09-28):

- https://cpicpgx.org/guidelines/
- https://www.pharmgkb.org/page/cyp2c19RefMaterials

Version 0.2.0 targets ArkOS 0.13.1 and Ark CLI 0.5.0 (`ark run FILE`). The
manifest pass prints TOML, `manifest = 1`: one required public grant,
`v1/genome/datasets/small-variants`, so the Ark refuses the run until small
variants are loaded, and the eleven `v1/genome/rsids/<rsid>` sites as optional
grants the owner switches on at approval.

## Report

TSV lines `rsid chromosome position reference genotype`, then:

`Research use only; genotypes as recorded in the loaded call file.`

A site that is not mounted prints `not granted` with empty fields: the owner
switched it off, or the Ark has no data for it, and the app cannot tell which.
Missing genotype files print `no call`. Neither is a reference call. I/O
errors other than not-found exit 1 with no report.

## Build and fixtures

```sh
bun run ark:build
bun run ark:test
```

`ark:test` always runs host `cargo test` against `fixtures/` and `goldens/`.
Fixtures (`present`, `unanswered`, `declined`, `eio`) are synthetic,
forward-strand GRCh38, in the 0.13 rsID layout (with `end`); `tests/grch38_panel.rs` keeps
every panel site in step with `scripts/genome-synth/variants.tsv`. On a real
run the Ark's own variant catalog is authoritative.
When `wasmtime` and `build/rsid-genotypes.wasm` exist, it also runs the
two-pass mount used by dark-bio/examples.
