#!/usr/bin/env bash
# Local Synthea FHIR R4 generation. Recipe matches open-twin tools/synthea at
# 130e3f64 (v4.0.0, seed 42), with the fixed dates, UTC and single generator
# thread of open-twin#218. Output is .synthea/ only — nothing from it is committed.
#
# Usage:
#   bun run synthea:generate                              # N=10, seed 42 → .synthea/fhir
#   bun run synthea:generate -- --preset eval             # synthea-v4-seed42 (N=30, 40–75)
#   bun run synthea:generate -- --preset training         # synthea-v4-seed4242 (N=10,000)
#   bun run synthea:generate -- --preset held-out         # synthea-v4-seed9001 (N=1,000)
#   bun run synthea:generate -- --population 12 --seed 7 --age 40-75   # → .synthea/synthea-v4-seed7/fhir
#   bun run synthea:generate -- --preset training --population 12 --dry-run
#
# Flags win over SYNTHEA_* env, env wins over the preset, the preset over the
# defaults. A preset fixes its seeds: a different --seed or SYNTHEA_SEED is
# refused. The output folder follows the cohort id: synthea-v4-seed42 (the
# evaluation cohort) stays in .synthea/fhir, every other cohort goes to
# .synthea/<cohort-id>/fhir. Presets are also listed in
# scripts/synthea/cohort-presets.ts.
#
# Reproducible: the same seeds, dates, population, ages and Synthea version give
# the same patient files byte for byte, in any folder and any time zone. Synthea
# simulates up to "now" unless given dates, so the script always passes -r and -e
# (SYNTHEA_REFERENCE_DATE, SYNTHEA_END_DATE as YYYYMMDD; default 20260101), runs
# Java in UTC and uses one generator thread. The manifest records the dates and
# contentSha256, the checksum of the patient files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Pinned values from open-twin tools/synthea/version.lock @ 130e3f64.
SYNTHEA_VERSION=v4.0.0
SYNTHEA_JAR_URL=https://github.com/synthetichealth/synthea/releases/download/v4.0.0/synthea-with-dependencies.jar
SYNTHEA_JAR_SHA256=ed43c20ad40ba5c3bc724503a5af032715fe3c491620b766148e7c2361e6ecc1

die() {
  echo "synthea: $*" >&2
  exit 1
}

PRESET=""
ARG_POPULATION=""
ARG_SEED=""
ARG_AGE=""
DRY_RUN=0
# The value after a flag, or a plain message when there is none.
value_of() {
  [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 needs a value"
  printf '%s' "$2"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preset) PRESET="$(value_of "$@")"; shift 2 ;;
    --population) ARG_POPULATION="$(value_of "$@")"; shift 2 ;;
    --seed) ARG_SEED="$(value_of "$@")"; shift 2 ;;
    --age) ARG_AGE="$(value_of "$@")"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --) shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

EVAL_COHORT_ID="synthea-v4-seed42"

# Preset values: population, seed, clinician seed, age range, reference and end date.
# Training and held-out never share a seed with the evaluation cohort (42).
P_POPULATION=10
P_SEED=42
P_CLINICIAN_SEED=43
P_AGE=""
P_REFERENCE_DATE=20260101
P_END_DATE=20260101
case "$PRESET" in
  "") ;;
  eval) P_POPULATION=30 P_SEED=42 P_CLINICIAN_SEED=43 P_AGE=40-75 P_REFERENCE_DATE=20260101 P_END_DATE=20260101 ;;
  training) P_POPULATION=10000 P_SEED=4242 P_CLINICIAN_SEED=4243 P_AGE=40-75 P_REFERENCE_DATE=20260101 P_END_DATE=20260101 ;;
  held-out) P_POPULATION=1000 P_SEED=9001 P_CLINICIAN_SEED=9002 P_AGE=40-75 P_REFERENCE_DATE=20260101 P_END_DATE=20260101 ;;
  *) die "unknown preset: $PRESET (eval, training or held-out)" ;;
esac

POPULATION="${ARG_POPULATION:-${SYNTHEA_POPULATION:-$P_POPULATION}}"
SEED="${ARG_SEED:-${SYNTHEA_SEED:-$P_SEED}}"
CLINICIAN_SEED="${SYNTHEA_CLINICIAN_SEED:-$P_CLINICIAN_SEED}"
STATE="${SYNTHEA_STATE:-Massachusetts}"
# Optional age range, e.g. 40-75, so the cohort has adults with labs.
AGE="${ARG_AGE:-${SYNTHEA_AGE:-$P_AGE}}"
# Synthea simulates up to "now" unless given dates, so without these two runs of
# the same seed differ by however far apart they started. Read in UTC (see below).
REFERENCE_DATE="${SYNTHEA_REFERENCE_DATE:-$P_REFERENCE_DATE}"
END_DATE="${SYNTHEA_END_DATE:-$P_END_DATE}"
# One generator thread: with more, Synthea v4.0.0 has a race that changes a few
# fields between runs of the same seed. Run cohorts in parallel for speed instead.
THREAD_POOL_SIZE=1
JAVA_MAJOR_REQUIRED=21

# Synthea parses dates leniently (20260230 becomes 2 March), so reject anything
# that is not a real calendar date rather than record a date Synthea didn't use.
valid_date() {
  [[ "$1" =~ ^[0-9]{8}$ ]] || return 1
  local y=$((10#${1:0:4})) m=$((10#${1:4:2})) d=$((10#${1:6:2})) max
  case "$m" in
    1 | 3 | 5 | 7 | 8 | 10 | 12) max=31 ;;
    4 | 6 | 9 | 11) max=30 ;;
    2) max=$((y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) ? 29 : 28)) ;;
    *) return 1 ;;
  esac
  ((d >= 1 && d <= max))
}

[[ "$POPULATION" =~ ^[1-9][0-9]*$ ]] || die "population must be a positive whole number (got: $POPULATION)"
[[ "$SEED" =~ ^[0-9]+$ ]] || die "seed must be a whole number (got: $SEED)"
[[ "$CLINICIAN_SEED" =~ ^[0-9]+$ ]] || die "clinician seed must be a whole number (got: $CLINICIAN_SEED)"
if [[ -n "$AGE" ]]; then
  [[ "$AGE" =~ ^[0-9]+-[0-9]+$ ]] || die "age must look like 40-75 (got: $AGE)"
fi
valid_date "$REFERENCE_DATE" ||
  die "SYNTHEA_REFERENCE_DATE must be a real date as YYYYMMDD (got: $REFERENCE_DATE)"
valid_date "$END_DATE" || die "SYNTHEA_END_DATE must be a real date as YYYYMMDD (got: $END_DATE)"
if [[ -n "$PRESET" ]]; then
  [[ "$SEED" == "$P_SEED" ]] ||
    die "seed $SEED conflicts with preset $PRESET (seed $P_SEED); drop --seed or SYNTHEA_SEED"
  [[ "$CLINICIAN_SEED" == "$P_CLINICIAN_SEED" ]] ||
    die "clinician seed $CLINICIAN_SEED conflicts with preset $PRESET (clinician seed $P_CLINICIAN_SEED)"
fi
# The evaluation answer key is computed from this exact cohort, so its dates are fixed.
if [[ "$PRESET" == "eval" ]]; then
  [[ "$REFERENCE_DATE" == "$P_REFERENCE_DATE" && "$END_DATE" == "$P_END_DATE" ]] ||
    die "preset eval is generated with reference and end date $P_REFERENCE_DATE; drop SYNTHEA_REFERENCE_DATE and SYNTHEA_END_DATE"
fi
((10#$END_DATE >= 10#$REFERENCE_DATE)) ||
  die "end date $END_DATE is before reference date $REFERENCE_DATE"
COHORT_ID="synthea-v4-seed${SEED}"

# Only the evaluation cohort lives in .synthea/fhir; the rest get their own folder.
if [[ "$COHORT_ID" == "$EVAL_COHORT_ID" ]]; then
  OUT_REL=".synthea"
else
  OUT_REL=".synthea/${COHORT_ID}"
fi
OUT_DIR="${ROOT}/${OUT_REL}"
CACHE_DIR="${ROOT}/.synthea/cache"
JAR="${CACHE_DIR}/synthea-with-dependencies.jar"
PROPS="${OUT_DIR}/synthea.properties"

require_java() {
  command -v java >/dev/null 2>&1 || die "Java $JAVA_MAJOR_REQUIRED+ is required (java not on PATH)"
  local ver major
  ver="$(java -version 2>&1 | head -n1)"
  major="$(java -XshowSettings:properties -version 2>&1 | awk -F= '/java.specification.version/ {gsub(/ /,"",$2); print $2; exit}')"
  case "$major" in
    1.*) major="${major#1.}" ;;
  esac
  major="${major%%.*}"
  [[ -n "$major" && "$major" -ge "$JAVA_MAJOR_REQUIRED" ]] ||
    die "Java $JAVA_MAJOR_REQUIRED+ required; found: $ver"
}

java_version() {
  java -XshowSettings:properties -version 2>&1 |
    awk -F= '/java.runtime.version/ {gsub(/ /,"",$2); print $2; exit}'
}

ensure_jar() {
  mkdir -p "$CACHE_DIR"
  if [[ ! -f "$JAR" ]]; then
    command -v curl >/dev/null 2>&1 || die "curl is required to download the Synthea JAR"
    echo "synthea: downloading $SYNTHEA_VERSION …"
    curl -fsSL -o "$JAR.partial" "$SYNTHEA_JAR_URL"
    mv "$JAR.partial" "$JAR"
  fi
  local actual
  actual="$(shasum -a 256 "$JAR" | awk '{print $1}')"
  [[ "$actual" == "$SYNTHEA_JAR_SHA256" ]] ||
    die "JAR checksum mismatch (expected $SYNTHEA_JAR_SHA256, got $actual). Delete $JAR and re-run."
}

write_properties() {
  cat >"$PROPS" <<EOF
exporter.baseDirectory = ./
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
generate.thread_pool_size = $THREAD_POOL_SIZE
EOF
}

# The checksum of the patient files, as open-twin#218 documents it:
#   cd fhir && sha256sum *.json | LC_ALL=C sort | sha256sum
# (shasum -a 256 prints the same lines). scripts/synthea/cohort-checksum.ts
# computes the same value.
content_sha256() {
  (
    cd "$OUT_DIR/fhir"
    shasum -a 256 -- *.json | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
  )
}

write_manifest() {
  local patient_count content_sha config_sha java_ver
  content_sha="$(content_sha256)"
  # Contents only, so the same settings give the same hash in every checkout.
  config_sha="$(shasum -a 256 <"$PROPS" | awk '{print $1}')"
  java_ver="$(java_version)"
  patient_count="$(find "$OUT_DIR/fhir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
  cat >"$OUT_DIR/manifest.json" <<EOF
{
  "syntheaVersion": "$SYNTHEA_VERSION",
  "jarSha256": "$SYNTHEA_JAR_SHA256",
  "cohortId": "$COHORT_ID",
  "preset": "${PRESET:-none}",
  "seed": $SEED,
  "clinicianSeed": $CLINICIAN_SEED,
  "population": $POPULATION,
  "state": "$STATE",
  "age": "$AGE",
  "referenceDate": "$REFERENCE_DATE",
  "endDate": "$END_DATE",
  "timezone": "UTC",
  "threadPoolSize": $THREAD_POOL_SIZE,
  "configSha256": "$config_sha",
  "javaVersion": "$java_ver",
  "exporter": "fhir",
  "patientFileCount": $patient_count,
  "contentSha256": "$content_sha"
}
EOF
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "preset=${PRESET:-none} cohort=$COHORT_ID population=$POPULATION seed=$SEED clinicianSeed=$CLINICIAN_SEED age=${AGE:-any} reference=$REFERENCE_DATE end=$END_DATE out=$OUT_REL"
  exit 0
fi

require_java
mkdir -p "$OUT_DIR"
ensure_jar
write_properties

# Never clear .synthea/fhir for anything but the evaluation cohort.
if [[ "$OUT_DIR" == "${ROOT}/.synthea" && "$COHORT_ID" != "$EVAL_COHORT_ID" ]]; then
  die "refusing to replace .synthea/fhir with $COHORT_ID"
fi
rm -rf "$OUT_DIR/fhir" "$OUT_DIR/manifest.json"
mkdir -p "$OUT_DIR"

AGE_ARGS=()
if [[ -n "$AGE" ]]; then
  AGE_ARGS=(-a "$AGE")
fi

echo "synthea: generating $COHORT_ID N=$POPULATION seed=$SEED clinicianSeed=$CLINICIAN_SEED age=${AGE:-any} reference=$REFERENCE_DATE end=$END_DATE ($SYNTHEA_VERSION) → $OUT_REL/"
(
  cd "$OUT_DIR"
  # Synthea reads the dates in the JVM's time zone; UTC keeps output the same on
  # every machine.
  java -Duser.timezone=UTC -jar "$JAR" \
    -c "$PROPS" \
    -s "$SEED" \
    -cs "$CLINICIAN_SEED" \
    -p "$POPULATION" \
    -r "$REFERENCE_DATE" \
    -e "$END_DATE" \
    ${AGE_ARGS[@]+"${AGE_ARGS[@]}"} \
    "$STATE"
)

write_manifest
echo "synthea: wrote $OUT_DIR/manifest.json"
cat "$OUT_DIR/manifest.json"
