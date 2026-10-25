#!/usr/bin/env bash
# Bun file: installs may nest @open-twin/fhir-core under fhir-r4 or a provider
# with symlink package.json entries that Turbopack rejects ("redirect can't be
# parsed as json"). Drop those nests; the root file: fhir-core satisfies peers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${ROOT}/node_modules/@open-twin"
[[ -d "${BASE}" ]] || exit 0

for pkg in fhir-r4 provider-oura provider-google-health provider-whoop provider-vitronic interpretation-contract; do
  nested="${BASE}/${pkg}/node_modules/@open-twin"
  if [[ -d "${nested}" ]]; then
    rm -rf "${nested}"
    echo "flatten-open-twin: removed ${pkg}/node_modules/@open-twin"
  fi
done
