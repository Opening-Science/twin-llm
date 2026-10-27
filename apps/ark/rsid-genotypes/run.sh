#!/bin/sh
# Two-pass runner in the spirit of dark-bio/examples, for a `manifest = 1` app.
# Usage: run.sh <module.wasm> <fixture-root>
# Required grants (`paths`) must exist in the fixture root. Optional grants
# (`optional`) are mounted when present and left out otherwise, which is how
# the Ark treats a declined or unavailable optional grant.
set -eu
wasm=$1
fixtures=$2
wasmtime="${WASMTIME:-wasmtime}"

command -v "$wasmtime" >/dev/null 2>&1 || {
  echo "missing wasmtime; install it or set WASMTIME" >&2
  exit 1
}

manifest="$("$wasmtime" "$wasm")"
grants() {
  printf '%s\n' "$manifest" | awk -v key="$1" '
    $0 ~ "^" key " = \\[" { on = 1 }
    on { print }
    on && /\]/ { on = 0 }
  ' | grep -oE '"v1/[^"]*"' | tr -d '"'
}

stage="$(mktemp -d)"
trap 'chmod -R u+w "$stage" 2>/dev/null || true; rm -rf "$stage"' EXIT
set --
mount() {
  mkdir -p "$stage/$(dirname "$1")"
  cp -R "$fixtures/$1" "$stage/$1"
}
for grant in $(grants paths); do
  if [ ! -d "$fixtures/$grant" ]; then
    printf 'fixture root lacks a required grant: %s\n' "$grant" >&2
    exit 1
  fi
  mount "$grant"
done
for grant in $(grants optional); do
  if [ -d "$fixtures/$grant" ]; then
    mount "$grant"
  fi
done
chmod -R a-w "$stage"
"$wasmtime" run --dir "$stage::/" "$wasm" /
