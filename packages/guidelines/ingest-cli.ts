/**
 * Host-only CLI. Ingests the guideline manifest into Postgres.
 * Full-text rows read gitignored data/guidelines/<id>/text.txt.
 * Cite-only rows write metadata and zero chunks.
 *
 * Usage (from repo root):
 *   bun --preload ./features/chat/response/preload-server-only.mjs packages/guidelines/ingest-cli.ts
 */
import { defaultIngestPorts, ingestManifest } from "./ingest";

const main = async (): Promise<void> => {
  const results = await ingestManifest(defaultIngestPorts());
  for (const row of results) {
    console.warn(`${row.id} ${row.ingestMode} chunks=${row.chunks}`);
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "ingest-failed";
  console.error(message);
  process.exit(1);
});
