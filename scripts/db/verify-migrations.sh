#!/usr/bin/env bash
# Verify Prisma migrations: deploy on DATABASE_URL, then assert zero drift
# against prisma/schema.prisma using SHADOW_DATABASE_URL (Prisma 7 config).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-migrations FAIL: DATABASE_URL is required" >&2
  exit 1
fi
if [[ -z "${SHADOW_DATABASE_URL:-}" ]]; then
  echo "verify-migrations FAIL: SHADOW_DATABASE_URL is required" >&2
  exit 1
fi

echo "=== prisma migrate deploy ==="
bunx prisma migrate deploy

echo "=== prisma migrate diff (expect empty / the unmodelable HNSW drop only) ==="
# Prisma 7.9 cannot declare USING hnsw on Unsupported("vector"), so migrate
# diff always emits this one DROP. verify-pgvector.sh asserts the index exists.
TOLERATED_HNSW_DROP='DROP INDEX "guideline_chunks_embedding_hnsw";'
set +e
diff_script="$(
  bunx prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema prisma/schema.prisma \
    --script \
    --exit-code 2>&1
)"
diff_status=$?
set -e
printf '%s\n' "${diff_script}"
if [[ "${diff_status}" -ne 0 ]]; then
  leftover=""
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" ]] && continue
    [[ "${line}" == "-- DropIndex" ]] && continue
    [[ "${line}" == "${TOLERATED_HNSW_DROP}" ]] && continue
    [[ "${line}" == *"injected env"* ]] && continue
    [[ "${line}" == "Loaded Prisma config from prisma.config.ts." ]] && continue
    [[ "${line}" == "Prisma schema loaded from prisma/schema.prisma." ]] && continue
    leftover="${leftover}${line}"$'\n'
  done <<< "${diff_script}"
  if [[ -n "${leftover}" ]]; then
    echo "verify-migrations FAIL: unexpected schema drift" >&2
    printf '%s' "${leftover}" >&2
    exit 1
  fi
  echo "migrate diff is the unmodelable HNSW drop only"
fi

echo "=== pgvector ==="
bash scripts/db/verify-pgvector.sh

# Prisma 7: `db execute` has no --url; it reads DATABASE_URL from prisma.config.ts.
echo "=== warehouse source CHECK (observations) ==="
set +e
oura_out="$(
  bunx prisma db execute --stdin <<'SQL' 2>&1
BEGIN;
INSERT INTO "subjects" ("subject_ref", "is_synthetic", "cohort_id")
  VALUES ('verify-check-subject', TRUE, 'verify-check');
INSERT INTO "bundles" ("sha", "cohort_id", "synthea_version")
  VALUES ('verify-check-sha', 'verify-check', '4.0.0');
INSERT INTO "observations" (
  "id", "subject_ref", "loinc", "display", "value", "unit_ucum",
  "effective_at", "source", "fhir_id", "bundle_sha"
) VALUES (
  'verify-check-obs-oura', 'verify-check-subject', '29463-7', 'Body Weight',
  1, 'kg', NOW(), 'oura', 'verify-check-fhir-oura', 'verify-check-sha'
);
COMMIT;
SQL
)"
oura_status=$?
set -e
printf '%s\n' "${oura_out}"
if [[ "${oura_status}" -eq 0 ]]; then
  echo "verify-migrations FAIL: INSERT source='oura' should have been rejected" >&2
  exit 1
fi
echo "${oura_out}" | grep -q 'observations_source_synthea' || {
  echo "verify-migrations FAIL: oura INSERT failed without observations_source_synthea in the message" >&2
  exit 1
}

set +e
synthea_out="$(
  bunx prisma db execute --stdin <<'SQL' 2>&1
BEGIN;
INSERT INTO "subjects" ("subject_ref", "is_synthetic", "cohort_id")
  VALUES ('verify-check-subject', TRUE, 'verify-check');
INSERT INTO "bundles" ("sha", "cohort_id", "synthea_version")
  VALUES ('verify-check-sha', 'verify-check', '4.0.0');
INSERT INTO "observations" (
  "id", "subject_ref", "loinc", "display", "value", "unit_ucum",
  "effective_at", "source", "fhir_id", "bundle_sha"
) VALUES (
  'verify-check-obs-synthea', 'verify-check-subject', '29463-7', 'Body Weight',
  1, 'kg', NOW(), 'synthea', 'verify-check-fhir-synthea', 'verify-check-sha'
);
ROLLBACK;
SQL
)"
synthea_status=$?
set -e
printf '%s\n' "${synthea_out}"
if [[ "${synthea_status}" -ne 0 ]]; then
  echo "verify-migrations FAIL: INSERT source='synthea' inside a rolled-back transaction should succeed" >&2
  exit 1
fi

echo "=== warehouse source CHECK (observation_non_numeric) ==="
set +e
nn_oura_out="$(
  bunx prisma db execute --stdin <<'SQL' 2>&1
BEGIN;
INSERT INTO "subjects" ("subject_ref", "is_synthetic", "cohort_id")
  VALUES ('verify-check-nn-subject', TRUE, 'verify-check');
INSERT INTO "bundles" ("sha", "cohort_id", "synthea_version")
  VALUES ('verify-check-nn-sha', 'verify-check', '4.0.0');
INSERT INTO "observation_non_numeric" (
  "id", "subject_ref", "loinc", "display", "value_type", "raw_value",
  "source", "fhir_id", "bundle_sha"
) VALUES (
  'verify-check-nn-oura', 'verify-check-nn-subject', '72166-2', 'Tobacco smoking status',
  'CodeableConcept', '{}'::jsonb, 'oura', 'verify-check-nn-fhir-oura', 'verify-check-nn-sha'
);
COMMIT;
SQL
)"
nn_oura_status=$?
set -e
printf '%s\n' "${nn_oura_out}"
if [[ "${nn_oura_status}" -eq 0 ]]; then
  echo "verify-migrations FAIL: INSERT observation_non_numeric source='oura' should have been rejected" >&2
  exit 1
fi
echo "${nn_oura_out}" | grep -q 'observation_non_numeric_source_synthea' || {
  echo "verify-migrations FAIL: oura INSERT failed without observation_non_numeric_source_synthea in the message" >&2
  exit 1
}

set +e
nn_synthea_out="$(
  bunx prisma db execute --stdin <<'SQL' 2>&1
BEGIN;
INSERT INTO "subjects" ("subject_ref", "is_synthetic", "cohort_id")
  VALUES ('verify-check-nn-subject', TRUE, 'verify-check');
INSERT INTO "bundles" ("sha", "cohort_id", "synthea_version")
  VALUES ('verify-check-nn-sha', 'verify-check', '4.0.0');
INSERT INTO "observation_non_numeric" (
  "id", "subject_ref", "loinc", "display", "value_type", "raw_value",
  "source", "fhir_id", "bundle_sha"
) VALUES (
  'verify-check-nn-synthea', 'verify-check-nn-subject', '72166-2', 'Tobacco smoking status',
  'CodeableConcept', '{}'::jsonb, 'synthea', 'verify-check-nn-fhir-synthea', 'verify-check-nn-sha'
);
ROLLBACK;
SQL
)"
nn_synthea_status=$?
set -e
printf '%s\n' "${nn_synthea_out}"
if [[ "${nn_synthea_status}" -ne 0 ]]; then
  echo "verify-migrations FAIL: INSERT observation_non_numeric source='synthea' inside a rolled-back transaction should succeed" >&2
  exit 1
fi

echo "=== guideline/knowledge source filter on the HNSW path ==="
bun --preload ./features/chat/response/preload-server-only.mjs scripts/db/verify-source-filter.ts

echo "=== audit chain ==="
bun packages/audit/verify-cli.ts --seed-ok
bunx prisma db execute --stdin <<'SQL'
UPDATE "audit_events" SET "row_count" = "row_count" + 1 WHERE "seq" = 1;
SQL
bun packages/audit/verify-cli.ts --expect-broken

echo "verify-migrations OK: deploy applied, migrations match schema, pgvector holds, source filter holds, source CHECK holds, audit chain probe holds"
