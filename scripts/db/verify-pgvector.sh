#!/usr/bin/env bash
# Probe pgvector after migrate deploy. Fail with the image name if the
# extension is missing so a leftover postgres:16 is obvious.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-pgvector FAIL: DATABASE_URL is required" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "verify-pgvector FAIL: psql is required (CI installs postgresql-client)" >&2
  exit 1
fi

sql() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "$1"
}

echo "=== pgvector available ==="
available="$(sql "SELECT 1 FROM pg_available_extensions WHERE name = 'vector';")"
printf '%s\n' "${available}"
if [[ "${available}" != "1" ]]; then
  echo "verify-pgvector FAIL: extension 'vector' is not available. Use image pgvector/pgvector:pg16, not postgres:16." >&2
  exit 1
fi

echo "=== pgvector installed ==="
installed="$(sql "SELECT extname FROM pg_extension WHERE extname = 'vector';")"
printf '%s\n' "${installed}"
if [[ "${installed}" != "vector" ]]; then
  echo "verify-pgvector FAIL: extension 'vector' is not installed after migrate deploy. Use image pgvector/pgvector:pg16." >&2
  exit 1
fi

echo "=== guideline_chunks.embedding type ==="
coltype="$(sql "SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname = 'guideline_chunks' AND a.attname = 'embedding' AND a.attnum > 0 AND NOT a.attisdropped;")"
printf '%s\n' "${coltype}"
if [[ "${coltype}" != "vector(768)" ]]; then
  echo "verify-pgvector FAIL: guideline_chunks.embedding must be vector(768)" >&2
  exit 1
fi

echo "=== HNSW cosine index ==="
hnsw_row="$(sql "
SELECT i.relname || '|' || t.relname || '|' || am.amname || '|' || opc.opcname
FROM pg_class i
JOIN pg_index ix ON ix.indexrelid = i.oid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_am am ON am.oid = i.relam
JOIN pg_opclass opc ON opc.oid = ix.indclass[0]
WHERE i.relname = 'guideline_chunks_embedding_hnsw'
  AND t.relname = 'guideline_chunks'
  AND am.amname = 'hnsw'
  AND opc.opcname = 'vector_cosine_ops';
")"
printf '%s\n' "${hnsw_row}"
if [[ "${hnsw_row}" != "guideline_chunks_embedding_hnsw|guideline_chunks|hnsw|vector_cosine_ops" ]]; then
  echo "verify-pgvector FAIL: guideline_chunks_embedding_hnsw must exist on guideline_chunks with access method hnsw and opclass vector_cosine_ops" >&2
  exit 1
fi

echo "=== 768-d vector insert (rollback) ==="
set +e
ok_out="$(
  bunx prisma db execute --stdin <<'SQL' 2>&1
BEGIN;
INSERT INTO "guideline_documents" (
  "id", "title", "year", "society", "doi", "url",
  "licence", "ingest_mode", "embedding_model", "embedding_dim"
) VALUES (
  'verify-pgvector-doc', 'verify', 2020, 'verify', '10.0.0.0/verify',
  'https://example.invalid/verify', 'cc-by-nc-nd-4.0', 'full_text',
  'nomic-embed-text', 768
);
INSERT INTO "guideline_chunks" (
  "id", "document_id", "section_heading", "text", "embedding"
) VALUES (
  'verify-pgvector-chunk',
  'verify-pgvector-doc',
  'verify',
  'verify',
  (SELECT ('[' || repeat('0,', 767) || '0]')::vector)
);
ROLLBACK;
SQL
)"
ok_status=$?
set -e
printf '%s\n' "${ok_out}"
if [[ "${ok_status}" -ne 0 ]]; then
  echo "verify-pgvector FAIL: 768-d vector insert inside a rolled-back transaction should succeed" >&2
  exit 1
fi

echo "=== 3-d vector insert must fail (rolled-back transaction) ==="
set +e
bad_out="$(
  bunx prisma db execute --stdin <<'SQL' 2>&1
BEGIN;
INSERT INTO "guideline_documents" (
  "id", "title", "year", "society", "doi", "url",
  "licence", "ingest_mode", "embedding_model", "embedding_dim"
) VALUES (
  'verify-pgvector-doc-3', 'verify', 2020, 'verify', '10.0.0.0/verify3',
  'https://example.invalid/verify3', 'cc-by-nc-nd-4.0', 'full_text',
  'nomic-embed-text', 768
);
INSERT INTO "guideline_chunks" (
  "id", "document_id", "section_heading", "text", "embedding"
) VALUES (
  'verify-pgvector-chunk-3',
  'verify-pgvector-doc-3',
  'verify',
  'verify',
  '[1,2,3]'::vector
);
ROLLBACK;
SQL
)"
bad_status=$?
set -e
printf '%s\n' "${bad_out}"
if [[ "${bad_status}" -eq 0 ]]; then
  echo "verify-pgvector FAIL: 3-d vector insert should have been rejected" >&2
  exit 1
fi

echo "verify-pgvector OK: vector extension present, embedding is vector(768), HNSW cosine holds, dim check holds"
