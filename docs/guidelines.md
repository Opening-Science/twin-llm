# Guideline corpus ingest and retrieval

Local catalogue of published guideline **passages as reference material** for
research hypothesis generation. It is not a statement about a person.

Chat exposes the closed tool `guideline_search(query, k)`. Retrieved text is
reference material, not a statement about the person.

## Licence gate

Full-text chunks are allowed only for the CC rows below. Stroke and the four ESC
titles are catalogue metadata (`cite_only`): title, year, society, DOI, URL. No
body, abstract, or tables.

**CC BY-NC-ND 4.0 and CC BY-NC 4.0 are non-commercial research use only.** That
is fine for Open Science Foundation research. Those chunks must be removed
before any commercial use.

Never commit PDFs or extracted full text. Operator-extracted UTF-8 lives under
gitignored `data/guidelines/<id>/text.txt`.

| id                           | Short title                                             | Year | Licence         | Ingest           |
| ---------------------------- | ------------------------------------------------------- | ---- | --------------- | ---------------- |
| ean-dementia-2020            | EAN dementia medical-management issues                  | 2020 | CC BY-NC-ND 4.0 | full text, local |
| ean-ms-palliative-2020       | EAN palliative care, severe progressive MS              | 2020 | CC BY-NC 4.0    | full text, local |
| ean-als-2024                 | EAN/ERN EURO-NMD ALS                                    | 2024 | CC BY-NC-ND 4.0 | full text, local |
| ean-stroke-rehab-2021        | EAN/EFNR early motor rehab after acute ischaemic stroke | 2021 | publisher       | cite by URL only |
| ean-narcolepsy-2021          | European narcolepsy, adults and children                | 2021 | CC BY-NC-ND 4.0 | full text, local |
| gscm-influenza-children-2024 | Chinese patent medicine, influenza in children          | 2024 | CC BY-NC-ND 4.0 | full text, local |
| esc-pe-2019                  | ESC acute pulmonary embolism                            | 2019 | ESC/OUP         | cite by URL only |
| esc-ccs-2019                 | ESC chronic coronary syndromes                          | 2019 | ESC/OUP         | cite by URL only |
| esc-svt-2019                 | ESC supraventricular tachycardia                        | 2019 | ESC/OUP         | cite by URL only |
| esc-dyslipidaemias-2019      | ESC/EAS dyslipidaemias                                  | 2019 | ESC/OUP         | cite by URL only |

Re-check the publisher OA badge before the first local download.

## Extract text locally

The repo does not parse PDFs. On the operator machine, for each open title,
Homebrew poppler:

```bash
pdftotext -layout guideline.pdf data/guidelines/<id>/text.txt
```

Then add heading markers the chunker already understands:

```
# Section: Non-invasive ventilation
# Rec: R3
# Class: Strong
# Evidence: moderate
# Page: 12

verbatim body
```

## Embeddings

Local Ollama only. Model `nomic-embed-text`, **768** dimensions.

- Ingest prefix: `search_document: `
- Query prefix: `search_query: ` (chat `guideline_search` uses this)

The host calls `POST {origin}/api/embed`. Origin is `OLLAMA_BASE_URL` with a
trailing `/v1` stripped (default `http://127.0.0.1:11434`). Older Ollama
daemons only expose `POST /api/embeddings`; that path is a local protocol
fallback on the same origin. There is no cloud fallback. If Ollama is down the
embed call returns empty.

## Postgres image (data-preserving)

`postgres:16` does not ship pgvector. CI, scratch, and shadow use
`pgvector/pgvector:pg16`. Scratch and shadow are disposable (`--rm`): recreate
them on the pgvector image.

**`twinllm-dev` holds wearable snapshots. Do not delete its volume.**
`pgvector/pgvector:pg16` is the same Postgres 16 on-disk format. Dump first,
stop the container, start the new image on the **same** data volume, then
verify. Never `docker volume rm`.

```bash
docker exec twinllm-dev pg_dump -U postgres postgres > /tmp/twinllm-dev.dump
docker inspect twinllm-dev --format '{{range .Mounts}}{{.Name}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
docker stop twinllm-dev
docker rm twinllm-dev
docker run -d --name twinllm-dev \
  -e POSTGRES_PASSWORD=postgres \
  -v <same-volume-or-bind>:/var/lib/postgresql/data \
  -p 127.0.0.1:5432:5432 \
  pgvector/pgvector:pg16
```

`-p 127.0.0.1:5432:5432` publishes Postgres on this machine only. A bare
`-p 5432:5432` listens on every network interface, which `LOCAL_ONLY=true`
assumes is not the case (see [providers.md](providers.md#local-only-mode)).
The same recreate steps rebind an existing container: check its mounts first,
because a container started without a volume keeps its data inside itself.

`docker rm twinllm-dev` removes the **container** only. The named volume or bind
mount stays. If the new process cannot see the old files, restore
`/tmp/twinllm-dev.dump` into that same volume. Do not create a new empty volume
as a substitute.

`bun run db:verify` probes that `vector` is available and installed, that
`guideline_chunks.embedding` is `vector(768)`, that a 768-d insert rolls back
cleanly, that a 3-d insert is rejected inside a rolled-back transaction, and
that the HNSW cosine index exists.

The drift check tolerates only the literal
`DROP INDEX "guideline_chunks_embedding_hnsw";` (plus its `-- DropIndex`
comment line, blanks, and the Prisma banner). `scripts/db/verify-pgvector.sh`
asserts that index exists on `guideline_chunks` with access method `hnsw` and
opclass `vector_cosine_ops`.

## Ingest

```bash
bun --preload ./features/chat/response/preload-server-only.mjs packages/guidelines/ingest-cli.ts
```

Writes catalogue rows for every manifest id. Open titles read
`data/guidelines/<id>/text.txt`. Cite-only titles write metadata and one
catalogue chunk: a sentence built from the title, society, year, DOI and URL,
and nothing from the publication, so `guideline_search` can find the title
(#272). An open title whose `text.txt` is missing on this machine is stored the
same way, as `cite_only`, and the CLI prints `(no local text.txt: catalogue
only)` for it; add the text and run the ingest again to replace it with the
full-text chunks. A catalogue hit always returns `passage: null`.

`bun run eval:guidelines` runs the same ingest against the database in
`.env.eval` (the evaluation Refresh, `docs/evaluation/question-set.md`).

## Retrieval

`guideline_search` embeds the query locally (`search_query: `), then ranks
`guideline_chunks` with cosine `<=>` (HNSW), filtered to documents with
`source = 'guideline'`. The same tables also hold the OpenTwin knowledge notes
(`source = 'opentwin-knowledge'`, `docs/knowledge.md`), which only
`knowledge_search` reads, and open-licence specialty literature
(`source = 'literature:<specialty>'`, `docs/literature.md`), which no chat
tool reads yet. `k` defaults to 5 and is capped
at 8. The call is audited as `guidelines.guideline_search` with `subject_ref`
null. Embed or database failure returns no hits and still writes the audit
row (`row_count` 0). There is no cloud fallback.

`cite_only` hits set `passage` to null. Catalogue fields (title, year,
society, DOI, URL) still return. Guideline hits never count toward
`sufficient_data`. A question about what a published guideline says is still
answered as reference material when `guideline_search` returned citations:
`abstained` is false, `interpretation.kind` stays `none`. Applying a guideline
to a person is refused.

The explainability panel lists title · year · DOI/URL. When
`sufficient_data` is false and `sources.guidelines` is non-empty it also
shows:

`Answer drawn from published guidelines only; no data about you was used.`

and:

`Published guideline passage as reference material, not a statement about this person.`

Offline eval: `bun test tests/guidelines` (CITE for “what does the guideline
say”, REFUSE when the question applies it to a person). Live hook:
`GUIDELINE_EVAL=1` — never set in CI.
