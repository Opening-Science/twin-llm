#!/usr/bin/env bash
# One batch of the 1M Synthea cohort again, with the whole record exported
# (exporter.years_of_history = 0) instead of the last 10 years (#295).
#
# The recipe is the 1M one (synthea-1m-v2/run-worker.sh, open-twin b4af273):
# Synthea v4.0.0, Massachusetts, 10,000 living people, seed 1000 + N, clinician
# seed 2000 + N, reference and end date 20260101, UTC, one generator thread.
# Only exporter.years_of_history differs. Output stays outside the repository.
#
# Usage:
#   scripts/heart-brain/full-history/generate-batch.sh <N> <out dir> [modules dir]
#
# With a modules dir, Synthea also loads the modules in it (-d); a module there
# with the same path as a built-in one replaces it (the rule-change test).
# Env: SYNTHEA_JAR (default .synthea/cache/synthea-with-dependencies.jar),
# PER_BATCH (10000), AGE (e.g. 55-95), KEEP (a keep module), SEED, CLINICIAN_SEED.
set -euo pipefail

die() {
  echo "full-history: $*" >&2
  exit 1
}

[[ $# -ge 2 ]] || die "usage: generate-batch.sh <N> <out dir> [modules dir]"
N="$1"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
MODULES="${3:-}"
[[ "$N" =~ ^[0-9]+$ ]] || die "batch number must be a whole number (got: $N)"

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# SYNTHEA_VERSION and SYNTHEA_JAR_SHA256, written from infrastructure/local-artefacts.ts.
# shellcheck source=../../synthea/synthea-pin.sh
source "$ROOT/scripts/synthea/synthea-pin.sh"
JAR="${SYNTHEA_JAR:-$ROOT/.synthea/cache/synthea-with-dependencies.jar}"
JAR_SHA256="$SYNTHEA_JAR_SHA256"
POPULATION="${PER_BATCH:-10000}"
SEED="${SEED:-$((1000 + 10#$N))}"
CLINICIAN_SEED="${CLINICIAN_SEED:-$((2000 + 10#$N))}"
NAME="$(printf 'batch-%03d' "$((10#$N))")"

[[ -f "$JAR" ]] || die "missing $JAR (Synthea $SYNTHEA_VERSION; not downloaded here)"
[[ "$(sha256sum "$JAR" | cut -d' ' -f1)" == "$JAR_SHA256" ]] || die "JAR is not Synthea $SYNTHEA_VERSION ($JAR_SHA256)"
[[ -f "$OUT/$NAME.tar.zst" ]] && die "$OUT/$NAME.tar.zst exists"

WORK="$OUT/$NAME.work"
rm -rf "$WORK"
mkdir -p "$WORK"
cat >"$WORK/synthea.properties" <<PROPS
exporter.baseDirectory = ./out/
exporter.use_uuid_filenames = false
exporter.fhir.export = true
exporter.fhir.bulk_data = false
exporter.hospital.fhir.export = false
exporter.practitioner.fhir.export = false
exporter.ccda.export = false
exporter.csv.export = false
exporter.text.export = false
exporter.json.export = false
exporter.bytesize.export = false
exporter.clinical_note.export = false
exporter.years_of_history = 0
generate.thread_pool_size = 1
PROPS

EXTRA=()
[[ -n "$MODULES" ]] && EXTRA+=(-d "$(cd "$MODULES" && pwd)")
[[ -n "${AGE:-}" ]] && EXTRA+=(-a "$AGE")
[[ -n "${KEEP:-}" ]] && EXTRA+=(-k "$(cd "$(dirname "$KEEP")" && pwd)/$(basename "$KEEP")")

start=$(date +%s)
(
  cd "$WORK"
  JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:--Xmx3g}" nice -n 10 java -Duser.timezone=UTC -jar "$JAR" \
    -c synthea.properties -s "$SEED" -cs "$CLINICIAN_SEED" -p "$POPULATION" \
    -r 20260101 -e 20260101 ${EXTRA[@]+"${EXTRA[@]}"} Massachusetts
) >"$OUT/$NAME.log" 2>&1
seconds=$(($(date +%s) - start))

fhir_sha="$(cd "$WORK/out/fhir" && sha256sum -- *.json | LC_ALL=C sort | sha256sum | cut -d' ' -f1)"
files="$(find "$WORK/out/fhir" -maxdepth 1 -name '*.json' | wc -l)"
props_sha="$(sha256sum "$WORK/synthea.properties" | cut -d' ' -f1)"
modules_sha=""
if [[ -n "$MODULES" ]]; then
  modules_sha="$(cd "$MODULES" && find . -type f -name '*.json' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
fi
nice -n 10 tar -C "$WORK/out" -cf - fhir | nice -n 10 zstd -T2 -10 -q -o "$OUT/$NAME.tar.zst.partial"
mv "$OUT/$NAME.tar.zst.partial" "$OUT/$NAME.tar.zst"
tar_sha="$(sha256sum "$OUT/$NAME.tar.zst" | cut -d' ' -f1)"
records="$(grep -o 'Records: total=[0-9]*, alive=[0-9]*, dead=[0-9]*' "$OUT/$NAME.log" | tail -1 || true)"
cat >"$OUT/$NAME.manifest.json" <<JSON
{
  "batch": "$NAME",
  "syntheaVersion": "$SYNTHEA_VERSION",
  "jarSha256": "$JAR_SHA256",
  "seed": $SEED,
  "clinicianSeed": $CLINICIAN_SEED,
  "population": $POPULATION,
  "age": "${AGE:-}",
  "keep": "${KEEP:+$(basename "$KEEP")}",
  "state": "Massachusetts",
  "referenceDate": "20260101",
  "endDate": "20260101",
  "yearsOfHistory": 0,
  "propertiesSha256": "$props_sha",
  "modulesSha256": "$modules_sha",
  "patientFileCount": $files,
  "records": "$records",
  "fhirSha256": "$fhir_sha",
  "archiveSha256": "$tar_sha",
  "seconds": $seconds
}
JSON
rm -rf "$WORK"
cat "$OUT/$NAME.manifest.json"
