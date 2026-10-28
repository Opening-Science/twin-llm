/**
 * Host CLI: training conversations from the 1M Synthea cohort, one batch at a
 * time.
 *
 *   bun run training:batches -- --batches 1001-1010
 *   bun run training:batches -- --batches 1100 --archives ../synthea-1m/batches \
 *     --work .synthea/batches --out training-data/out --keep
 *   bun run training:batches -- --batches 1001-1010 --skip-rejected [--max-rejected-share 0.02]
 *   bun run training:batches -- --batches 1001 --workers 4
 *
 * Per batch: unpack the archive → wearables:generate → warehouse:ingest of the
 * FHIR and the wearables (split across --workers ingest processes, default
 * cores - 1) → training:conversations → delete the cohort's
 * warehouse rows → remove the unpacked files (unless --keep). Audit rows stay:
 * the audit chain is append-only. A batch whose conversation manifest exists is
 * skipped. Each step runs the existing CLI with `.env.training`; its output
 * goes to `<work>/logs/`, and this prints one line per step with its time.
 *
 * Refuses to run unless DATA_MODE=synthetic, the database is not the dev
 * database of `.env.local`, and it holds no Demo cohort. Stops at the first
 * failed step, including any rejected bundle, unless --skip-rejected: then
 * rejected FHIR bundles are listed in `<out>/<cohort>.rejected.json` and the
 * conversation manifest, their subjects' wearable series are left out, and
 * the batch still stops when more than --max-rejected-share (default 1%) of
 * its bundles are rejected. See docs/training-data.md.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { type BatchCohort } from "../synthea/cohort-presets";

import {
  type BatchArgs,
  type BatchPaths,
  batchPaths,
  databaseRefusal,
  envFileValue,
  formatBytes,
  formatDuration,
  ingestCounts,
  parseBatchArgs,
  rejectedBundles,
  rejectedReasons,
  rejectedRecord,
  rejectionRefusal,
  type Step,
  stepPlan,
  TRAINING_ENV_FILE,
  wearableCounts,
  wearableFilesFor,
  workManifest,
} from "./batches";

const PRELOAD = "./features/chat/response/preload-server-only.mjs";

export type CommandResult = Readonly<{ code: number; stdout: string }>;

export type ClearedRows = Readonly<{
  subjects: number;
  observations: number;
  nonNumeric: number;
  bundles: number;
}>;

export type BatchRunDeps = Readonly<{
  dataMode: () => string;
  databaseUrl: () => string;
  /** DATABASE_URL of `.env.local` and `.env.synthetic.example`, null when unset. */
  devDatabaseUrls: () => Promise<readonly (string | null)[]>;
  /** Subjects of a Demo cohort in this database; the training database has none. */
  demoSubjects: () => Promise<number>;
  exists: (path: string) => Promise<boolean>;
  readJson: (path: string) => Promise<unknown>;
  writeJson: (path: string, value: unknown) => Promise<void>;
  /** Removes a file or directory and everything under it; no error when missing. */
  remove: (path: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  /** Files and bytes under a directory (0, 0 when missing). */
  dirSize: (path: string) => Promise<Readonly<{ files: number; bytes: number }>>;
  fileSize: (path: string) => Promise<number>;
  /** Runs a command; its stdout and stderr also go to `log`. */
  run: (command: readonly string[], log: string) => Promise<CommandResult>;
  clearCohort: (cohortId: string) => Promise<ClearedRows>;
  /** The Patient id (subject_ref) in a FHIR bundle file, or null. */
  subjectRefOf: (path: string) => Promise<string | null>;
  now: () => number;
}>;

export type BatchRunIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

/** The command line of each step that runs an existing CLI. */
export const stepCommand = (
  step: Step,
  batch: BatchCohort,
  paths: BatchPaths,
  bun: string,
  workers: number | null = null,
): readonly string[] | null => {
  const withEnv = [bun, `--env-file=${TRAINING_ENV_FILE}`, "--preload", PRELOAD];
  const ingestWorkers = workers === null ? [] : ["--workers", String(workers)];
  switch (step) {
    case "unpack":
      return ["tar", "--zstd", "-xf", paths.archive, "-C", paths.dir];
    case "wearables":
      return [bun, "scripts/synthetic-wearables/generate.ts", "--in", paths.fhir];
    case "ingest fhir":
      return [
        ...withEnv,
        "scripts/warehouse/ingest.ts",
        paths.fhir,
        "--cohort",
        batch.cohortId,
        ...ingestWorkers,
      ];
    case "ingest wearables":
      return [
        ...withEnv,
        "scripts/warehouse/ingest.ts",
        paths.wearables,
        "--cohort",
        batch.cohortId,
        ...ingestWorkers,
      ];
    case "conversations":
      return [
        ...withEnv,
        "scripts/training-data/build-conversations.ts",
        "--cohort",
        batch.cohortId,
        "--out",
        paths.records,
      ];
    case "clear rows":
    case "remove files":
      return null;
  }
};

const logPath = (paths: BatchPaths, batch: BatchCohort, step: Step) =>
  join(paths.logs, `${batch.cohortId}.${step.replace(" ", "-")}.log`);

type StepOutcome =
  Readonly<{ ok: true; detail: string }> | Readonly<{ ok: false; error: string }>;

const runStep = async (
  step: Step,
  batch: BatchCohort,
  paths: BatchPaths,
  args: Pick<BatchArgs, "skipRejected" | "maxRejectedShare" | "workers">,
  bun: string,
  deps: BatchRunDeps,
): Promise<StepOutcome> => {
  const log = logPath(paths, batch, step);
  const command = stepCommand(step, batch, paths, bun, args.workers);
  const failed = (result: CommandResult) => ({
    ok: false as const,
    error: `exit ${result.code}; see ${log}`,
  });

  switch (step) {
    case "unpack": {
      const manifest = workManifest(batch, await deps.readJson(paths.archiveManifest));
      if (typeof manifest === "string") return { ok: false, error: manifest };
      await deps.remove(paths.dir);
      await deps.mkdir(paths.dir);
      const result = await deps.run(command ?? [], log);
      if (result.code !== 0) return failed(result);
      await deps.writeJson(paths.manifest, manifest);
      await deps.writeJson(paths.unpacked, { archive: paths.archive });
      const size = await deps.dirSize(paths.fhir);
      return { ok: true, detail: `${size.files} files, ${formatBytes(size.bytes)}` };
    }
    case "wearables": {
      const result = await deps.run(command ?? [], log);
      if (result.code !== 0) return failed(result);
      const counts = wearableCounts(result.stdout);
      return {
        ok: true,
        detail: counts
          ? `${counts.subjects} subjects, ${counts.readings} readings`
          : "written",
      };
    }
    case "ingest fhir": {
      const result = await deps.run(command ?? [], log);
      const counts = ingestCounts(result.stdout);
      if (counts === null || (result.code !== 0 && counts.rejected === 0)) {
        return failed(result);
      }
      const inserted = `${counts.inserted} bundles inserted, ${counts.already} already ingested`;
      if (counts.rejected === 0) {
        // A stale list from an earlier run would leave people out for nothing.
        await deps.remove(paths.rejected);
        return { ok: true, detail: inserted };
      }
      const reasons = rejectedReasons(result.stdout);
      const refusal = rejectionRefusal(counts, args);
      if (refusal !== null) {
        return {
          ok: false,
          error: `${counts.rejected} bundles rejected (${reasons}); ${refusal}; see ${log}`,
        };
      }
      const rejected = await Promise.all(
        rejectedBundles(result.stdout).map(async (bundle) => ({
          ...bundle,
          subjectRef: await deps.subjectRefOf(join(paths.fhir, bundle.file)),
        })),
      );
      const total = counts.inserted + counts.already + counts.rejected;
      await deps.writeJson(
        paths.rejected,
        rejectedRecord(batch.cohortId, total, rejected),
      );
      return {
        ok: true,
        detail: `${inserted}; skipped ${counts.rejected} of ${total} bundles (${reasons}), listed in ${paths.rejected}`,
      };
    }
    case "ingest wearables": {
      // Leave out the series of subjects whose FHIR bundle was refused, so
      // no subject has wearable rows only.
      const record = (await deps.exists(paths.rejected))
        ? await deps.readJson(paths.rejected)
        : null;
      const subjects = Reflect.get(Object(record), "subjects");
      const refs = Array.isArray(subjects)
        ? subjects.map((subject: unknown) => {
            const ref = Reflect.get(Object(subject), "subject_ref");
            return typeof ref === "string" ? ref : null;
          })
        : [];
      const leftOut = (
        await Promise.all(
          wearableFilesFor(paths.wearables, refs).map(async (file) => {
            if (!(await deps.exists(file))) return 0;
            await deps.remove(file);
            return 1;
          }),
        )
      ).reduce((sum: number, n) => sum + n, 0);
      const result = await deps.run(command ?? [], log);
      const counts = ingestCounts(result.stdout);
      if (result.code !== 0 || counts === null || counts.rejected > 0) {
        const rejected =
          counts && counts.rejected > 0
            ? `${counts.rejected} bundles rejected (${rejectedReasons(result.stdout)}), `
            : "";
        return { ok: false, error: `${rejected}exit ${result.code}; see ${log}` };
      }
      const left =
        refs.length > 0 ? `, ${leftOut} series of skipped subjects left out` : "";
      return {
        ok: true,
        detail: `${counts.inserted} bundles inserted, ${counts.already} already ingested${left}`,
      };
    }
    case "conversations": {
      const withRejected = (await deps.exists(paths.rejected))
        ? [...(command ?? []), "--rejected", paths.rejected]
        : (command ?? []);
      const result = await deps.run(withRejected, log);
      if (result.code !== 0) return failed(result);
      const manifest = await deps.readJson(paths.conversationManifest);
      const count = (key: string) =>
        typeof manifest === "object" && manifest !== null
          ? Number(Reflect.get(manifest, key))
          : Number.NaN;
      const bytes = await deps.fileSize(paths.records);
      return {
        ok: true,
        detail: `${count("conversations")} conversations from ${count("subjects")} subjects, ${formatBytes(bytes)} JSONL`,
      };
    }
    case "clear rows": {
      const rows = await deps.clearCohort(batch.cohortId);
      return {
        ok: true,
        detail: `deleted ${rows.subjects} subjects, ${rows.observations} numeric and ${rows.nonNumeric} non-numeric rows, ${rows.bundles} bundles`,
      };
    }
    case "remove files": {
      const size = await deps.dirSize(paths.dir);
      await deps.remove(paths.dir);
      return { ok: true, detail: `freed ${formatBytes(size.bytes)}` };
    }
  }
};

export const runTrainingBatches = async (
  argv: readonly string[],
  io: BatchRunIo,
  deps: BatchRunDeps,
  bun: string,
): Promise<number> => {
  if (deps.dataMode() !== "synthetic") {
    io.stderr.write("training:batches runs only with DATA_MODE=synthetic.\n");
    return 1;
  }
  const args = parseBatchArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  const refusal = databaseRefusal(deps.databaseUrl(), await deps.devDatabaseUrls());
  if (refusal !== null) {
    io.stderr.write(`${refusal}\n`);
    return 1;
  }
  const demo = await deps.demoSubjects();
  if (demo > 0) {
    io.stderr.write(
      `Refused: this database holds ${demo} Demo cohort subjects, so it is a dev database. Use a database for training cohorts only.\n`,
    );
    return 1;
  }

  // Every archive a batch still needs must be there before the first one starts.
  const missing: string[] = [];
  for (const batch of args.batches) {
    const paths = batchPaths(batch, args);
    if (
      !(await deps.exists(paths.conversationManifest)) &&
      !(await deps.exists(paths.archive))
    ) {
      missing.push(paths.archive);
    }
  }
  if (missing.length > 0) {
    io.stderr.write(`No archive at: ${missing.join(", ")}\n`);
    return 1;
  }

  const runStart = deps.now();
  for (const batch of args.batches) {
    const paths = batchPaths(batch, args);
    const done = await deps.exists(paths.conversationManifest);
    const steps = stepPlan({
      done,
      unpacked: await deps.exists(paths.unpacked),
      keep: args.keep,
    });
    const label = `${batch.cohortId} (${batch.role})`;
    if (done) io.stdout.write(`${label}: conversations already written, skipped\n`);
    await deps.mkdir(paths.logs);
    await deps.mkdir(args.out);
    const batchStart = deps.now();
    for (const [index, step] of steps.entries()) {
      const start = deps.now();
      const outcome = await runStep(step, batch, paths, args, bun, deps);
      const took = formatDuration(deps.now() - start);
      const position = `[${index + 1}/${steps.length}] ${step}`;
      if (!outcome.ok) {
        io.stderr.write(`${label} ${position} failed after ${took}: ${outcome.error}\n`);
        return 1;
      }
      io.stdout.write(`${label} ${position}: ${outcome.detail} (${took})\n`);
    }
    if (!done) {
      io.stdout.write(`${label}: done in ${formatDuration(deps.now() - batchStart)}\n`);
    }
  }
  io.stdout.write(
    `${args.batches.length} batches in ${formatDuration(deps.now() - runStart)}\n`,
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { serverEnv } = await import("../../infrastructure/env");
  const { database } = await import("../../infrastructure/database");
  const { DEMO_COHORTS } = await import("../../packages/query-tools/scope");
  const { syntheaPatientOf } = await import("../synthetic-wearables/bundle");

  const readText = async (path: string): Promise<string | null> => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  };
  const dirSize = async (path: string): Promise<{ files: number; bytes: number }> => {
    const entries = await readdir(path, { withFileTypes: true, recursive: true }).catch(
      () => [],
    );
    const sizes = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => (await stat(join(entry.parentPath, entry.name))).size),
    );
    return { files: sizes.length, bytes: sizes.reduce((sum, size) => sum + size, 0) };
  };

  const code = await runTrainingBatches(
    process.argv.slice(2),
    process,
    {
      dataMode: () => serverEnv().DATA_MODE,
      databaseUrl: () => serverEnv().DATABASE_URL,
      devDatabaseUrls: async () =>
        Promise.all(
          [".env.local", ".env.synthetic.example"].map(async (file) => {
            const text = await readText(file);
            return text === null ? null : envFileValue(text, "DATABASE_URL");
          }),
        ),
      demoSubjects: () =>
        database().subject.count({ where: { cohortId: { in: [...DEMO_COHORTS] } } }),
      exists: async (path) =>
        stat(path).then(
          () => true,
          () => false,
        ),
      readJson: async (path) => {
        const text = await readText(path);
        if (text === null) return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return null;
        }
      },
      writeJson: async (path, value) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
      },
      remove: (path) => rm(path, { recursive: true, force: true }),
      mkdir: async (path) => {
        await mkdir(path, { recursive: true });
      },
      dirSize,
      fileSize: async (path) => (await stat(path)).size,
      run: (command, log) =>
        new Promise((done, fail) => {
          const [file = "", ...rest] = command;
          const out = createWriteStream(log);
          const child = spawn(file, rest, { stdio: ["ignore", "pipe", "pipe"] });
          const kept: Buffer[] = [];
          child.stdout.on("data", (chunk: Buffer) => {
            kept.push(chunk);
            out.write(chunk);
          });
          child.stderr.on("data", (chunk: Buffer) => out.write(chunk));
          child.on("error", fail);
          child.on("close", (exit) =>
            out.end(() =>
              done({ code: exit ?? 1, stdout: Buffer.concat(kept).toString("utf8") }),
            ),
          );
        }),
      clearCohort: async (cohortId) => {
        // Plain DELETEs: a batch is millions of rows, and Prisma's deleteMany
        // through a relation filter reads the ids first. Audit rows stay.
        const db = database();
        const observations = await db.$executeRaw`
          DELETE FROM observations o USING subjects s
          WHERE o.subject_ref = s.subject_ref AND s.cohort_id = ${cohortId}`;
        const nonNumeric = await db.$executeRaw`
          DELETE FROM observation_non_numeric o USING subjects s
          WHERE o.subject_ref = s.subject_ref AND s.cohort_id = ${cohortId}`;
        const bundles = await db.$executeRaw`
          DELETE FROM bundles WHERE cohort_id = ${cohortId}`;
        const subjects = await db.$executeRaw`
          DELETE FROM subjects WHERE cohort_id = ${cohortId}`;
        return { subjects, observations, nonNumeric, bundles };
      },
      now: () => Date.now(),
      subjectRefOf: async (path) => {
        const text = await readText(path);
        if (text === null) return null;
        try {
          return syntheaPatientOf(JSON.parse(text) as unknown)?.id ?? null;
        } catch {
          return null;
        }
      },
    },
    process.execPath,
  );
  await database().$disconnect();
  process.exit(code);
}
