/**
 * Runs each shard of `warehouse:ingest` in its own bun process
 * (`ingest-worker.ts`), all at once. The processes inherit this process's
 * environment (DATABASE_URL included) and stderr; their stdout carries one
 * JSON outcome per file. A file a process never reported, because it died or
 * wrote something unreadable, is reported as `ingest-failed`: its bundle was
 * written in one transaction or not at all, and a re-run finds it by sha256.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { ingestReportSchema } from "../../packages/warehouse/ingest-report";

import { type FileOutcome, type IngestJob, missingOutcomes } from "./ingest-shard";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const PRELOAD = join(ROOT, "features/chat/response/preload-server-only.mjs");
const WORKER = join(HERE, "ingest-worker.ts");

/** A worker's stdout line as an outcome for one of its files, or null. */
export const parseOutcome = (
  line: string,
  files: ReadonlySet<string>,
): FileOutcome | null => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const path: unknown = Reflect.get(Object(value), "path");
  const kind: unknown = Reflect.get(Object(value), "kind");
  if (typeof path !== "string" || !files.has(path)) return null;
  if (kind === "not-bundle") return { path, kind };
  const report = ingestReportSchema.safeParse(Reflect.get(Object(value), "report"));
  return kind === "report" && report.success ? { path, kind, report: report.data } : null;
};

const runShard = async (
  files: readonly string[],
  job: IngestJob,
  onOutcome: (outcome: FileOutcome) => void,
): Promise<void> => {
  const child = spawn(process.execPath, ["--preload", PRELOAD, WORKER], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const exited = new Promise<void>((done) => {
    child.on("close", () => done());
    child.on("error", () => done());
  });
  child.stdin.end(JSON.stringify({ files, job }));
  const listed = new Set(files);
  const reported = new Set<string>();
  for await (const line of createInterface({ input: child.stdout })) {
    const outcome = parseOutcome(line, listed);
    if (outcome === null || reported.has(outcome.path)) continue;
    reported.add(outcome.path);
    onOutcome(outcome);
  }
  await exited;
  missingOutcomes(files, reported).forEach(onOutcome);
};

export const spawnShards = async (
  shards: readonly (readonly string[])[],
  job: IngestJob,
  onOutcome: (outcome: FileOutcome) => void,
): Promise<void> => {
  await Promise.all(shards.map((files) => runShard(files, job, onOutcome)));
};
