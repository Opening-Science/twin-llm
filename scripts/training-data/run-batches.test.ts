import { describe, expect, test } from "bun:test";

import { noConsentStore } from "../../infrastructure/learning-consent";

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
  const wearablesAtIngest: string[] = [];
  const made: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let clock = 0;
  const respond = overrides.respond ?? outputFor;
  const deps: BatchRunDeps = {
    dataMode: () => "synthetic",
    databaseUrl: () => TRAINING,
    devDatabaseUrls: async () => [DEV, null],
    demoSubjects: async () => 0,
    subjectRows: async () => [],
    learning: noConsentStore(),
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
    mkdir: async (path) => {
      made.push(path);
    },
    dirSize: async (path) => {
      const under = [...files.keys()].filter((key) => key.startsWith(`${path}/`));
      return { files: under.length, bytes: under.length * 1_000_000 };
    },
    fileSize: async () => 4_000,
    run: async (command, log) => {
      commands.push(`${command.join(" ")} > ${log}`);
      const result = respond(command);
      // tar writes the fhir files, wearables:generate one series per subject,
      // training:conversations its manifest.
      if (command[0] === "tar" && result.code === 0) {
        const dir = command[command.length - 1];
        files.set(`${dir}/fhir/a.json`, {});
        files.set(`${dir}/fhir/b.json`, {});
      }
      const inDir = command[command.indexOf("--in") + 1] ?? "";
      if (command.includes("scripts/synthetic-wearables/generate.ts")) {
        const wearables = inDir.replace(/fhir$/, "wearables");
        files.set(`${wearables}/subject-a.wearables.json`, {});
        files.set(`${wearables}/subject-b.wearables.json`, {});
      }
      const ingestDir = command[command.indexOf("scripts/warehouse/ingest.ts") + 1] ?? "";
      if (ingestDir.endsWith("/wearables")) {
        wearablesAtIngest.push(
          ...[...files.keys()].filter((key) => key.startsWith(`${ingestDir}/`)),
        );
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
    subjectRefOf: async (path) =>
      `subject-${(path.split("/").pop() ?? "").replace(/\.json$/, "")}`,
    ...overrides,
  };
  const io = {
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
  };
  return { deps, io, files, commands, cleared, out, err, wearablesAtIngest, made };
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
        "synthea-v4-seed1001 (training) [7/7] remove files: freed 6.0 MB (1m 01s)",
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

  test("--workers goes to both ingest steps and nowhere else", async () => {
    const h = harness();
    expect(await run(h, ["--batches", "1001", "--workers", "4"])).toBe(0);
    expect(h.commands.filter((command) => command.includes("--workers 4"))).toEqual([
      expect.stringContaining(
        "scripts/warehouse/ingest.ts work/synthea-v4-seed1001/fhir --cohort synthea-v4-seed1001 --workers 4 >",
      ),
      expect.stringContaining(
        "scripts/warehouse/ingest.ts work/synthea-v4-seed1001/wearables --cohort synthea-v4-seed1001 --workers 4 >",
      ),
    ]);
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

  test("--tracks writes one set per track after the default set, with --track", async () => {
    const h = harness();
    expect(await run(h, ["--batches", "1001", "--tracks", "diet,sleep"])).toBe(0);
    const env =
      "bun --env-file=.env.training --preload ./features/chat/response/preload-server-only.mjs";
    expect(
      h.commands.filter((command) => command.includes("build-conversations")),
    ).toEqual([
      `${env} scripts/training-data/build-conversations.ts --cohort synthea-v4-seed1001 --out out/synthea-v4-seed1001.jsonl > work/logs/synthea-v4-seed1001.conversations.log`,
      `${env} scripts/training-data/build-conversations.ts --cohort synthea-v4-seed1001 --track diet --out out/synthea-v4-seed1001.diet.jsonl > work/logs/synthea-v4-seed1001.conversations.log`,
      `${env} scripts/training-data/build-conversations.ts --cohort synthea-v4-seed1001 --track sleep --out out/synthea-v4-seed1001.sleep.jsonl > work/logs/synthea-v4-seed1001.conversations.log`,
    ]);
    expect(h.out.join("")).toContain("4.0 KB JSONL; tracks diet, sleep (1m 01s)");
  });

  test("a batch with the default set but not a track's runs again for the track only", async () => {
    const h = harness({
      files: [["out/synthea-v4-seed1001.manifest.json", { conversations: 54 }]],
    });
    expect(await run(h, ["--batches", "1001", "--tracks", "diet"])).toBe(0);
    const conversations = h.commands.filter((command) =>
      command.includes("build-conversations"),
    );
    expect(conversations.length).toBe(1);
    expect(conversations[0]).toContain("--track diet");
    const done = harness({
      files: [
        ["out/synthea-v4-seed1001.manifest.json", { conversations: 54 }],
        ["out/synthea-v4-seed1001.diet.manifest.json", { conversations: 20 }],
      ],
    });
    expect(await run(done, ["--batches", "1001", "--tracks", "diet"])).toBe(0);
    expect(done.commands).toEqual([]);
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
      "synthea-v4-seed1001 (training) [3/7] ingest fhir failed after 1m 01s: 1 bundles rejected (1 ot-unit-policy); pass --skip-rejected to leave them out; see work/logs/synthea-v4-seed1001.ingest-fhir.log\n",
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

/** warehouse:ingest output with `rejected` of `total` FHIR bundles refused. */
const ingestWithRejects =
  (rejected: readonly string[], total: number) =>
  (command: readonly string[]): CommandResult => {
    const dir = command[command.indexOf("scripts/warehouse/ingest.ts") + 1] ?? "";
    if (!dir.endsWith("/fhir")) return outputFor(command);
    const lines = rejected.map((line) => `${line}\n`).join("");
    return {
      code: rejected.length > 0 ? 1 : 0,
      stdout: `${lines}\nBundles: ${total - rejected.length} inserted, 0 already ingested, ${rejected.length} rejected\n`,
    };
  };

describe("--skip-rejected", () => {
  const ONE_OF_200 = ingestWithRejects(["b.json: rejected (ot-unit-policy)"], 200);

  test("without it, a rejected bundle stops the batch and says how to go on", async () => {
    const h = harness({ respond: ONE_OF_200 });
    expect(await run(h, ["--batches", "1001"])).toBe(1);
    expect(h.err).toEqual([
      "synthea-v4-seed1001 (training) [3/7] ingest fhir failed after 1m 01s: 1 bundles rejected (1 ot-unit-policy); pass --skip-rejected to leave them out; see work/logs/synthea-v4-seed1001.ingest-fhir.log\n",
    ]);
    expect(h.files.has("out/synthea-v4-seed1001.rejected.json")).toBe(false);
  });

  test("lists the rejected subjects, leaves out their series and names the file to conversations", async () => {
    const h = harness({ respond: ONE_OF_200 });
    expect(await run(h, ["--batches", "1001", "--skip-rejected"])).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out.slice(2, 5).join("")).toBe(
      [
        "synthea-v4-seed1001 (training) [3/7] ingest fhir: 199 bundles inserted, 0 already ingested; skipped 1 of 200 bundles (1 ot-unit-policy), listed in out/synthea-v4-seed1001.rejected.json (1m 01s)",
        "synthea-v4-seed1001 (training) [4/7] ingest wearables: 11 bundles inserted, 0 already ingested, 1 series of skipped subjects left out (1m 01s)",
        "synthea-v4-seed1001 (training) [5/7] conversations: 54 conversations from 9 subjects, 4.0 KB JSONL (1m 01s)",
        "",
      ].join("\n"),
    );
    expect(h.files.get("out/synthea-v4-seed1001.rejected.json")).toEqual({
      cohort_id: "synthea-v4-seed1001",
      bundles: 200,
      rejected: 1,
      reasons: { "ot-unit-policy": 1 },
      subjects: [
        { subject_ref: "subject-b", file: "b.json", reasons: ["ot-unit-policy"] },
      ],
    });
    expect(h.wearablesAtIngest).toEqual([
      "work/synthea-v4-seed1001/wearables/subject-a.wearables.json",
    ]);
    // The out dir exists before the list is written into it.
    expect(h.made.slice(0, 2)).toEqual(["work/logs", "out"]);
    expect(h.commands[4]).toBe(
      "bun --env-file=.env.training --preload ./features/chat/response/preload-server-only.mjs scripts/training-data/build-conversations.ts --cohort synthea-v4-seed1001 --out out/synthea-v4-seed1001.jsonl --rejected out/synthea-v4-seed1001.rejected.json > work/logs/synthea-v4-seed1001.conversations.log",
    );
  });

  test("more than 1% rejected stops the batch even with the flag", async () => {
    const two = ingestWithRejects(
      ["a.json: rejected (ingest-failed)", "b.json: rejected (ingest-failed)"],
      100,
    );
    const h = harness({ respond: two });
    expect(await run(h, ["--batches", "1001", "--skip-rejected"])).toBe(1);
    expect(h.err).toEqual([
      "synthea-v4-seed1001 (training) [3/7] ingest fhir failed after 1m 01s: 2 bundles rejected (2 ingest-failed); more than 1.0% of 100 bundles; check the log, or raise --max-rejected-share; see work/logs/synthea-v4-seed1001.ingest-fhir.log\n",
    ]);
    expect(h.files.has("out/synthea-v4-seed1001.rejected.json")).toBe(false);
    expect(h.cleared).toEqual([]);

    const raised = harness({ respond: two });
    expect(
      await run(raised, [
        "--batches",
        "1001",
        "--skip-rejected",
        "--max-rejected-share",
        "0.02",
      ]),
    ).toBe(0);
    expect(raised.wearablesAtIngest).toEqual([]);
  });

  test("a clean ingest removes a stale list, and conversations get no --rejected", async () => {
    const h = harness({
      files: [["out/synthea-v4-seed1001.rejected.json", { rejected: 1 }]],
    });
    expect(await run(h, ["--batches", "1001", "--skip-rejected"])).toBe(0);
    expect(h.files.has("out/synthea-v4-seed1001.rejected.json")).toBe(false);
    expect(h.commands[4]?.includes("--rejected")).toBe(false);
    expect(h.wearablesAtIngest.length).toBe(2);
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

  test("refuses a database that holds a subject that is not synthetic (#145)", async () => {
    const h = harness({
      subjectRows: async () => [
        { kind: "subject", cohortId: "synthea-v4-seed1001", isSynthetic: true },
        { kind: "subject", cohortId: "synthea-v4-seed1001", isSynthetic: false },
      ],
    });
    expect(await run(h, ["--batches", "1001"])).toBe(1);
    expect([h.err, h.commands, h.cleared]).toEqual([
      [
        'Refused (SOURCE_NOT_SYNTHETIC): A subject in cohort "synthea-v4-seed1001" is not marked synthetic or its cohort is not a listed synthetic cohort, and it has no owner who could consent. Nothing was read.\n',
      ],
      [],
      [],
    ]);
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
