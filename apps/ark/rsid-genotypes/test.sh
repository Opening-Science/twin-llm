#!/bin/sh
# Host formatter goldens always. Wasmtime two-pass when the toolchain is present.
set -eu
cd "$(dirname "$0")"
cargo test --locked

if ! command -v "${WASMTIME:-wasmtime}" >/dev/null 2>&1; then
  echo "skip wasmtime two-pass (wasmtime not on PATH)"
  exit 0
fi
if [ ! -f build/rsid-genotypes.wasm ]; then
  echo "skip wasmtime two-pass (run bun run ark:build first)"
  exit 0
fi

got="$(mktemp)"
eio_err="$(mktemp)"
trap 'rm -f "$got" "$eio_err"' EXIT
sh run.sh build/rsid-genotypes.wasm fixtures/present >"$got"
cmp -s "$got" goldens/present.tsv
sh run.sh build/rsid-genotypes.wasm fixtures/unanswered >"$got"
cmp -s "$got" goldens/unanswered.tsv
sh run.sh build/rsid-genotypes.wasm fixtures/declined >"$got"
cmp -s "$got" goldens/declined.tsv
set +e
sh run.sh build/rsid-genotypes.wasm fixtures/eio >"$got" 2>"$eio_err"
status=$?
set -e
[ "$status" -ne 0 ]
grep -q 'rs4244285' "$eio_err"
if grep -q 'Research use only' "$got"; then
  echo "eio run printed the report footer" >&2
  exit 1
fi
echo "wasmtime two-pass goldens ok"
