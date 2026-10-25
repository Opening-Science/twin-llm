#!/usr/bin/env bash
# Local Synthea FHIR R4 generation. Recipe matches open-twin tools/synthea at
# 130e3f64 (v4.0.0, seed 42). Output is .synthea/ only — nothing from it is committed.
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

# Preset values: population, seed, clinician seed, age range.
# Training and held-out never share a seed with the evaluation cohort (42).
P_POPULATION=10
P_SEED=42
P_CLINICIAN_SEED=43
P_AGE=""
case "$PRESET" in
  "") ;;
  eval) P_POPULATION=30 P_SEED=42 P_CLINICIAN_SEED=43 P_AGE=40-75 ;;
  training) P_POPULATION=10000 P_SEED=4242 P_CLINICIAN_SEED=4243 P_AGE=40-75 ;;
  held-out) P_POPULATION=1000 P_SEED=9001 P_CLINICIAN_SEED=9002 P_AGE=40-75 ;;
  *) die "unknown preset: $PRESET (eval, training or held-out)" ;;
esac

POPULATION="${ARG_POPULATION:-${SYNTHEA_POPULATION:-$P_POPULATION}}"
SEED="${ARG_SEED:-${SYNTHEA_SEED:-$P_SEED}}"
CLINICIAN_SEED="${SYNTHEA_CLINICIAN_SEED:-$P_CLINICIAN_SEED}"
STATE="${SYNTHEA_STATE:-Massachusetts}"
# Optional age range, e.g. 40-75, so the cohort has adults with labs.
AGE="${ARG_AGE:-${SYNTHEA_AGE:-$P_AGE}}"
JAVA_MAJOR_REQUIRED=21

[[ "$POPULATION" =~ ^[1-9][0-9]*$ ]] || die "population must be a positive whole number (got: $POPULATION)"
[[ "$SEED" =~ ^[0-9]+$ ]] || die "seed must be a whole number (got: $SEED)"
[[ "$CLINICIAN_SEED" =~ ^[0-9]+$ ]] || die "clinician seed must be a whole number (got: $CLINICIAN_SEED)"
if [[ -n "$AGE" ]]; then
  [[ "$AGE" =~ ^[0-9]+-[0-9]+$ ]] || die "age must look like 40-75 (got: $AGE)"
fi
if [[ -n "$PRESET" ]]; then
  [[ "$SEED" == "$P_SEED" ]] ||
    die "seed $SEED conflicts with preset $PRESET (seed $P_SEED); drop --seed or SYNTHEA_SEED"
  [[ "$CLINICIAN_SEED" == "$P_CLINICIAN_SEED" ]] ||
    die "clinician seed $CLINICIAN_SEED conflicts with preset $PRESET (clinician seed $P_CLINICIAN_SEED)"
fi
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
  cat >"$PROPS" <<'EOF'
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
EOF
}

write_manifest() {
  local patient_count
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
  "exporter": "fhir",
  "patientFileCount": $patient_count
}
EOF
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "preset=${PRESET:-none} cohort=$COHORT_ID population=$POPULATION seed=$SEED clinicianSeed=$CLINICIAN_SEED age=${AGE:-any} out=$OUT_REL"
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

echo "synthea: generating $COHORT_ID N=$POPULATION seed=$SEED clinicianSeed=$CLINICIAN_SEED age=${AGE:-any} ($SYNTHEA_VERSION) → $OUT_REL/"
(
  cd "$OUT_DIR"
  java -jar "$JAR" \
    -c "$PROPS" \
    -s "$SEED" \
    -cs "$CLINICIAN_SEED" \
    -p "$POPULATION" \
    ${AGE_ARGS[@]+"${AGE_ARGS[@]}"} \
    "$STATE"
)

write_manifest
echo "synthea: wrote $OUT_DIR/manifest.json"
cat "$OUT_DIR/manifest.json"
