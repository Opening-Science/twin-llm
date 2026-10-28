/**
 * Host-only CLI. Embeds the articles under data/literature/<specialty> into
 * the guideline tables with source "literature:<specialty>", then removes
 * articles whose files are gone. Needs local Ollama (nomic-embed-text) and
 * the pgvector database.
 *
 * Usage (from repo root):
 *   bun run literature:ingest
 *   bun run literature:ingest -- --specialty diet
 */
import { parseIngestArgs } from "./args";
import { defaultLiteratureIngestPorts, ingestLiterature } from "./ingest";

const main = async (): Promise<void> => {
  const parsed = parseIngestArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(2);
  }
  const specialties = parsed.value.specialty ? [parsed.value.specialty] : undefined;
  const result = await ingestLiterature(defaultLiteratureIngestPorts(), specialties);
  for (const row of result.documents) {
    console.warn(`${row.source} ${row.id} chunks=${row.chunks}`);
  }
  console.warn(`documents=${result.documents.length} pruned=${result.pruned}`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "literature-ingest-failed";
  console.error(message);
  process.exit(1);
});
