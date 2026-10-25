#!/bin/sh
# Two-pass runner matching dark-bio/examples tools/run.sh.
# Usage: run.sh <module.wasm> <fixture-root>
set -eu
wasm=$1
fixtures=$2
wasmtime="${WASMTIME:-wasmtime}"

command -v "$wasmtime" >/dev/null 2>&1 || {
  echo "missing wasmtime; install it or set WASMTIME" >&2
  exit 1
}

manifest="$("$wasmtime" "$wasm")"
stage="$(mktemp -d)"
trap 'chmod -R u+w "$stage" 2>/dev/null || true; rm -rf "$stage"' EXIT
set --
for dataset in $(printf '%s\n' "$manifest" | grep -oE '"v1/[^"]*"' | tr -d '"'); do
  if [ ! -d "$fixtures/$dataset" ]; then
    printf 'fixture root has no declared dataset: %s\n' "$dataset" >&2
    exit 1
  fi
  mkdir -p "$stage/$(dirname "$dataset")"
  cp -R "$fixtures/$dataset" "$stage/$dataset"
  set -- "$@" --dir "$stage/$dataset::/$dataset"
done
chmod -R a-w "$stage"
"$wasmtime" run "$@" "$wasm" /
