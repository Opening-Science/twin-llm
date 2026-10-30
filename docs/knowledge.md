# OpenTwin knowledge

Short notes, written by us, that tell the model what TwinLLM's own metrics,
units, data sources and limits mean. They are non-personal reference material
and are cited separately from published guidelines. Added in B4 (Annex 1
October: "non-personal OpenTwin knowledge/RAG layer").

## What is in the corpus

`knowledge/opentwin/`, one Markdown file per topic:

| File                      | What it covers                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `metric-glossary.md`      | Every wearable metric TwinLLM shows (Oura, Whoop, Google Health): what, unit, device, limits  |
| `units-and-codes.md`      | LOINC, UCUM, warehouse storage, BP panels, no unit conversion, metric keys, rounding, missing |
| `provenance-and-audit.md` | Where each kind of data comes from, what the audit log records, synthetic vs personal mode    |
| `system-limits.md`        | Research tool, what the tools compute and refuse, abstain, decline, answer classes            |
| `biomarker-catalogue.md`  | The 67 Anchor biomarkers: name, LOINC, unit, system, region, D12 "no single body location"    |

`metric-glossary.md` follows `STEM_LABELS`, `STEM_KINDS` and
`GOOGLE_MEASURE_LABELS` in `infrastructure/format-measure.ts`. When a metric is
added there, add it to the glossary.

`biomarker-catalogue.md` is generated from the pinned Anchor catalogue
(`packages/biomarkers`); do not edit it by hand. After an open-twin pin bump run
`bun run knowledge:biomarkers`. `packages/knowledge/biomarker-catalogue.test.ts`
fails when the committed file no longer matches the pin.

## File format

The format the guideline chunker already reads in marked mode
(`packages/guidelines/chunk.ts`):

```
# Title: Metric glossary

One preamble paragraph (dropped at ingest).

# Section: Heart rate variability (HRV)
Plain text, one retrieval chunk per section.
```

- `# Title:` is required; the file's id is `opentwin-<file name>`.
- Each `# Section:` becomes one chunk, embedded as `<title> · <section>` plus the
  body. Keep a section under about 2,000 characters so it stays one chunk.
- No other `#` lines inside a section.
- The copy is scanned by `bun run lint:claims` like `docs/`.

## Adding a file

1. Write `knowledge/opentwin/<topic>.md` in the format above.
2. Add retrieval cases to `tests/knowledge/cases.json` if the topic is new.
3. `bun run lint:claims` and `bun test --preload ./features/chat/response/preload-server-only.mjs packages/knowledge tests/knowledge`.
4. Re-ingest: `bun run knowledge:ingest` (runbook, "Knowledge ingest").

## How it is stored and searched

Knowledge files share the guideline tables. `guideline_documents.source` is
`opentwin-knowledge` for them and `guideline` for guidelines (column
`guideline_documents.source`). Each search tool filters on its own source,
so a guideline search never returns a knowledge note and the reverse.

- Ingest: `packages/knowledge/ingest.ts`. Embeddings are local
  (`nomic-embed-text` on loopback Ollama, `packages/guidelines/embed.ts`). A
  file whose embedding fails stops the run before anything is written for it.
  Files that were removed are pruned. Chunk ids are `<id>-<n>`, so a re-run
  writes the same rows.
- Search: one transaction with `SET LOCAL hnsw.iterative_scan = relaxed_order`
  (pgvector 0.8+). The source filter runs after the HNSW scan, so without it a
  large guideline corpus could crowd out every knowledge row. `db:verify`
  checks this on the index path with 5000 synthetic guideline chunks
  (`scripts/db/verify-source-filter.ts`): knowledge rows come back and every
  row has the requested source. It does not ask for exact ids, since HNSW is
  approximate and can miss a near row on some index builds (#267).
- Tool: `knowledge_search(query, k)`, k default 5, max 8. Audited as
  `knowledge.knowledge_search`, `subject_ref` null; a failure stores a marker
  (`knowledge-search-failed`), never the error text.
- Response document: hits land in `data_basis.sources.knowledge` as
  `{ tool, id, title, file, sectionHeading, licence }`. They never count toward
  `sufficient_data`. A knowledge-only answer is shown (not abstained) with
  `answer_class: information`, uncertainty `moderate` and reason
  `knowledge_only`.
- Panel: "OpenTwin knowledge", one line per file and section
  (`title · section · file`), with the attribution line.

## Licence

The notes are © 2026 Open Science Foundation, CC BY 4.0
(`knowledge/opentwin/LICENSE.md`). The code that ingests and searches them is
Apache-2.0. `biomarker-catalogue.md` is built from `@open-twin/anchor-layer` (MIT);
LOINC codes and names are © Regenstrief Institute, Inc., used under the LOINC
licence. See `NOTICE`.
