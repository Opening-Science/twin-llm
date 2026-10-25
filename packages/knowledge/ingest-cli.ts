/**
 * Host-only CLI. Ingests knowledge/opentwin/*.md into the guideline tables
 * with source "opentwin-knowledge", then removes files that no longer exist.
 *
 * Usage (from repo root): bun run knowledge:ingest
 */
import { defaultKnowledgeIngestPorts, ingestKnowledge } from "./ingest";

const main = async (): Promise<void> => {
  const result = await ingestKnowledge(defaultKnowledgeIngestPorts());
  for (const row of result.documents) {
    console.warn(`${row.id} chunks=${row.chunks}`);
  }
  console.warn(`pruned=${result.pruned}`);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "knowledge-ingest-failed";
  console.error(message);
  process.exit(1);
});
