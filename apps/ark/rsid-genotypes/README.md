# rsid-genotypes

Ark WASI app: a closed panel of public CPIC / PharmGKB star-allele defining
rsIDs. It prints recorded genotypes only. It does not interpret them and it
does not name a product.

Citation (allele definition tables, 2026-09-28):

- https://cpicpgx.org/guidelines/
- https://www.pharmgkb.org/page/cyp2c19RefMaterials

## Report

TSV lines `rsid chromosome position reference genotype`, then:

`Research use only; genotypes as recorded in the loaded call file.`

Missing genotype files print `no call`. That is not a reference call. I/O
errors other than not-found exit 1 with no report.

## Build and fixtures

```sh
bun run ark:build
bun run ark:test
```

`ark:test` always runs host `cargo test` against `fixtures/` and `goldens/`.
When `wasmtime` and `build/rsid-genotypes.wasm` exist, it also runs the
two-pass mount used by dark-bio/examples.
