import { describe, expect, test } from "bun:test";

import { type BatchRunDeps, type CommandResult, runTrainingBatches } from "./run-batches";

const ARGS = ["--archives", "arch", "--work", "work", "--out", "out"] as const;
const DEV = "postgresql://user:password@127.0.0.1:5432/twin_llm_synthetic";
const TRAINING = "postgresql://postgres:postgres@127.0.0.1:5432/twin_llm_training";

const archivedManifest = (seed: number) => ({
  syntheaVersion: "v4.0.0",
  seed,
  clinicianSeed: seed + 1000,
  population: 10000,
});

/** What each fake command prints, by the script or program it runs. */
const outputFor = (command: readonly string[]): CommandResult => {
  const script = command.find((part) => part.startsWith("scripts/")) ?? command[0];
  switch (script) {
    case "tar":
      return { code: 0, stdout: "" };
    case "scripts/synthetic-wearables/generate.ts":
      return {
        code: 0,
        stdout:
          "Subjects: 9, deceased left out: 2, other files: 0\nReadings: 4500 over 90 days\n",
      };
    case "scripts/warehouse/ingest.ts":
      return {
        code: 0,
        stdout: "\nBundles: 11 inserted, 0 already ingested, 0 rejected\n",
      };
    default:
      return { code: 0, stdout: "Conversations written\n" };
  }
};

const harness = (
  overrides: Partial<BatchRunDeps> & {
    readonly files?: ReadonlyArray<readonly [string, unknown]>;
    readonly respond?: (command: readonly string[]) => CommandResult;
  } = {},
) => {
  const files = new Map<string, unknown>([
    ["arch/batch-001.tar.zst", "archive"],
    ["arch/batch-001.manifest.json", archivedManifest(1001)],
    ["arch/batch-002.tar.zst", "archive"],
    ["arch/batch-002.manifest.json", archivedManifest(1002)],
    ...(overrides.files ?? []),
  ]);
  const commands: string[] = [];
  const cleared: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let clock = 0;
  const respond = overrides.respond ?? outputFor;
  const deps: BatchRunDeps = {
    dataMode: () => "synthetic",
    databaseUrl: () => TRAINING,
    devDatabaseUrls: async () => [DEV, null],
    demoSubjects: async () => 0,
    exists: async (path) =>
      [...files.keys()].some((key) => key === path || key.startsWith(`${path}/`)),
    readJson: async (path) => files.get(path) ?? null,
    writeJson: async (path, value) => {
      files.set(path, value);
    },
    remove: async (path) => {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    mkdir: async () => undefined,
    dirSize: async (path) => {
      const under = [...files.keys()].filter((key) => key.startsWith(`${path}/`));
      return { files: under.length, bytes: under.length * 1_000_000 };
    },
    fileSize: async () => 4_000,
    run: async (command, log) => {
      commands.push(`${command.join(" ")} > ${log}`);
      const result = respond(command);
      // tar writes the fhir files; training:conversations writes its manifest.
      if (command[0] === "tar" && result.code === 0) {
        const dir = command[command.length - 1];
        files.set(`${dir}/fhir/a.json`, {});
        files.set(`${dir}/fhir/b.json`, {});
      }
      const outIndex = command.indexOf("--out");
      if (outIndex !== -1 && result.code === 0) {
        const base = (command[outIndex + 1] ?? "").replace(/\.jsonl$/, "");
        files.set(`${base}.manifest.json`, { conversations: 54, subjects: 9 });
      }
      return result;
    },
    clearCohort: async (cohortId) => {
      cleared.push(cohortId);
      return { subjects: 11, observations: 3000, nonNumeric: 400, bundles: 20 };
    },
    now: () => {
      clock += 61_000;
      return clock;
    },
    ...overrides,
  };
  const io = {
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
  };
  return { deps, io, files, commands, cleared, out, err };
};

const run = (h: ReturnType<typeof harness>, argv: readonly string[]) =>
  runTrainingBatches([...argv, ...ARGS], h.io, h.deps, "bun");

describe("runTrainingBatches", () => {
  test("one batch end to end: every step once, in order, then the files are gone", async () => {
    const h = harness();
    expect(await run(h, ["--batches", "1001"])).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out.join("")).toBe(
      [
        "synthea-v4-seed1001 (training) [1/7] unpack: 2 files, 2.0 MB (1m 01s)",
        "synthea-v4-seed1001 (training) [2/7] wearables: 9 subjects, 4500 readings (1m 01s)",
        "synthea-v4-seed1001 (training) [3/7] ingest fhir: 11 bundles inserted, 0 already ingested (1m 01s)",
        "synthea-v4-seed1001 (training) [4/7] ingest wearables: 11 bundles inserted, 0 already ingested (1m 01s)",
        "synthea-v4-seed1001 (training) [5/7] conversations: 54 conversations from 9 subjects, 4.0 KB JSONL (1m 01s)",
        "synthea-v4-seed1001 (training) [6/7] clear rows: deleted 11 subjects, 3000 numeric and 400 non-numeric rows, 20 bundles (1m 01s)",
        "synthea-v4-seed1001 (training) [7/7] remove files: freed 4.0 MB (1m 01s)",
        "synthea-v4-seed1001 (training): done in 15m 15s",
        "1 batches in 17m 17s",
        "",
      ].join("\n"),
    );
    const env =
      "bun --env-file=.env.training --preload ./features/chat/response/preload-server-only.mjs";
    expect(h.commands).toEqual([
      "tar --zstd -xf arch/batch-001.tar.zst -C work/synthea-v4-seed1001 > work/logs/synthea-v4-seed1001.unpack.log",
      "bun scripts/synthetic-wearables/generate.ts --in work/synthea-v4-seed1001/fhir > work/logs/synthea-v4-seed1001.wearables.log",
      `${env} scripts/warehouse/ingest.ts work/synthea-v4-seed1001/fhir --cohort synthea-v4-seed1001 > work/logs/synthea-v4-seed1001.ingest-fhir.log`,
      `${env} scripts/warehouse/ingest.ts work/synthea-v4-seed1001/wearables --cohort synthea-v4-seed1001 > work/logs/synthea-v4-seed1001.ingest-wearables.log`,
      `${env} scripts/training-data/build-conversations.ts --cohort synthea-v4-seed1001 --out out/synthea-v4-seed1001.jsonl > work/logs/synthea-v4-seed1001.conversations.log`,
    ]);
    expect(h.cleared).toEqual(["synthea-v4-seed1001"]);
    expect([...h.files.keys()].filter((key) => key.startsWith("work/"))).toEqual([]);
  });

  test("the unpacked manifest carries the cohort id while the batch runs", async () => {
    const h = harness();
    expect(await run(h, ["--batches", "1001", "--keep"])).toBe(0);
    expect(h.files.get("work/synthea-v4-seed1001/manifest.json")).toEqual({
      ...archivedManifest(1001),
      cohortId: "synthea-v4-seed1001",
    });
    expect(h.files.has("work/synthea-v4-seed1001/fhir/a.json")).toBe(true);
  });

  test("a batch with a conversation manifest is skipped; only leftovers are cleared", async () => {
    const h = harness({
      files: [["out/synthea-v4-seed1001.manifest.json", { conversations: 54 }]],
    });
    expect(await run(h, ["--batches", "1001-1002"])).toBe(0);
    expect(h.out.slice(0, 3).join("")).toBe(
      [
        "synthea-v4-seed1001 (training): conversations already written, skipped",
        "synthea-v4-seed1001 (training) [1/2] clear rows: deleted 11 subjects, 3000 numeric and 400 non-numeric rows, 20 bundles (1m 01s)",
        "synthea-v4-seed1001 (training) [2/2] remove files: freed 0 B (1m 01s)",
        "",
      ].join("\n"),
    );
    expect(h.commands.filter((command) => command.includes("seed1001"))).toEqual([]);
    expect(h.commands.filter((command) => command.includes("seed1002")).length).toBe(5);
    expect(h.cleared).toEqual(["synthea-v4-seed1001", "synthea-v4-seed1002"]);
  });

  test("a kept unpacked copy is not unpacked again", async () => {
    const h = harness({ files: [["work/synthea-v4-seed1001/.unpacked", {}]] });
    expect(await run(h, ["--batches", "1001", "--keep"])).toBe(0);
    expect(h.commands.filter((command) => command.startsWith("tar"))).toEqual([]);
    expect(h.out[0]).toBe(
      "synthea-v4-seed1001 (training) [1/5] wearables: 9 subjects, 4500 readings (1m 01s)\n",
    );
  });

  test("a rejected bundle stops the run before conversations or clean-up", async () => {
    const h = harness({
      respond: (command) =>
        command.includes("scripts/warehouse/ingest.ts")
          ? {
              code: 1,
              stdout:
                "a.json: inserted 3 rows (1 non-numeric)\nb.json: rejected (ot-unit-policy)\n\nBundles: 10 inserted, 0 already ingested, 1 rejected\n",
            }
          : outputFor(command),
    });
    expect(await run(h, ["--batches", "1001-1002"])).toBe(1);
    expect(h.err).toEqual([
      "synthea-v4-seed1001 (training) [3/7] ingest fhir failed after 1m 01s: 1 bundles rejected (1 ot-unit-policy), exit 1; see work/logs/synthea-v4-seed1001.ingest-fhir.log\n",
    ]);
    expect(h.commands.length).toBe(3);
    expect(h.cleared).toEqual([]);
  });

  test("an ingest that prints no summary is a failure even with exit 0", async () => {
    const h = harness({
      respond: (command) =>
        command.includes("scripts/warehouse/ingest.ts")
          ? { code: 0, stdout: "" }
          : outputFor(command),
    });
    expect(await run(h, ["--batches", "1001"])).toBe(1);
    expect(h.err).toEqual([
      "synthea-v4-seed1001 (training) [3/7] ingest fhir failed after 1m 01s: exit 0; see work/logs/synthea-v4-seed1001.ingest-fhir.log\n",
    ]);
  });

  test("a batch manifest for another seed stops before unpacking", async () => {
    const h = harness({
      files: [["arch/batch-001.manifest.json", archivedManifest(1002)]],
    });
    expect(await run(h, ["--batches", "1001"])).toBe(1);
    expect(h.err).toEqual([
      "synthea-v4-seed1001 (training) [1/7] unpack failed after 1m 01s: The batch manifest for batch-001.tar.zst does not match seed 1001, clinician seed 2001, N=10000.\n",
    ]);
    expect(h.commands).toEqual([]);
  });
});

describe("runTrainingBatches guards", () => {
  test("runs only with DATA_MODE=synthetic", async () => {
    const h = harness({ dataMode: () => "personal" });
    expect(await run(h, ["--batches", "1001"])).toBe(1);
    expect(h.err).toEqual(["training:batches runs only with DATA_MODE=synthetic.\n"]);
    expect(h.commands).toEqual([]);
  });

  test("refuses the dev database of .env.local", async () => {
    const h = harness({ databaseUrl: () => DEV });
    expect(await run(h, ["--batches", "1001"])).toBe(1);
    expect(h.err).toEqual([
      "Refused: twin_llm_synthetic is the dev database. Point DATABASE_URL in .env.training at a database for training cohorts only.\n",
    ]);
    expect(h.commands).toEqual([]);
    expect(h.cleared).toEqual([]);
  });

  test("refuses a database that holds a Demo cohort", async () => {
    const h = harness({ demoSubjects: async () => 35 });
    expect(await run(h, ["--batches", "1001"])).toBe(1);
    expect(h.err).toEqual([
      "Refused: this database holds 35 Demo cohort subjects, so it is a dev database. Use a database for training cohorts only.\n",
    ]);
    expect(h.cleared).toEqual([]);
  });

  test("names every missing archive before any batch starts", async () => {
    const h = harness();
    expect(await run(h, ["--batches", "1001-1004"])).toBe(1);
    expect(h.err).toEqual([
      "No archive at: arch/batch-003.tar.zst, arch/batch-004.tar.zst\n",
    ]);
    expect(h.commands).toEqual([]);
  });

  test("bad batches", async () => {
    const h = harness();
    expect(await run(h, ["--batches", "42"])).toBe(1);
    expect(h.err).toEqual(["--batches are seeds 1001 to 1100 (got: 42).\n"]);
  });
});
