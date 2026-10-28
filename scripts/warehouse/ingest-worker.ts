/**
 * One ingest process of `warehouse:ingest` (`spawn-shards.ts` starts it).
 * Reads `{ files, job }` as JSON on stdin, ingests the files in order, and
 * writes one `FileOutcome` per file as a JSON line on stdout. Outcomes hold
 * file paths, counts and fixed reason codes only, never a value or an error
 * message. Not meant to be run by hand.
 */
import { database } from "../../infrastructure/database";
import { ingestBundle } from "../../packages/warehouse/ingest-bundle";

import { type IngestJob, ingestShard } from "./ingest-shard";
import { readJsonFile } from "./read-json";

type WorkerInput = Readonly<{ files: readonly string[]; job: IngestJob }>;

const isInput = (value: unknown): value is WorkerInput => {
  const files: unknown = Reflect.get(Object(value), "files");
  const job: unknown = Reflect.get(Object(value), "job");
  return (
    Array.isArray(files) &&
    files.every((file) => typeof file === "string") &&
    typeof Reflect.get(Object(job), "cohortId") === "string" &&
    typeof Reflect.get(Object(job), "syntheaVersion") === "string"
  );
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const input: unknown = JSON.parse(await readStdin());
if (!isInput(input)) {
  console.error("ingest-worker: expected { files, job } on stdin");
  process.exit(2);
}

await ingestShard(
  input.files,
  input.job,
  { readJson: readJsonFile, ingest: ingestBundle },
  (outcome) => {
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  },
);
// No process.exit: the process ends once stdout is flushed and the pool is closed.
await database().$disconnect();
