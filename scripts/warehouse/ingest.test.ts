import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { IngestReport } from "../../packages/warehouse/ingest-report";
import { isSyntheaBundle } from "../../packages/warehouse/synthea-marker";

import { runWarehouseIngest, type JsonRead, type WarehouseIngestDeps } from "./ingest";
import { ingestShard, type ShardPorts } from "./ingest-shard";

/** Stands for a *.json file whose text does not parse. */
const INVALID = Symbol("invalid JSON");

const FIXTURE_DIR = join(import.meta.dir, "../../tests/fixtures/synthea");
const FIXTURES = ["bp-panel.json", "patient-1.json", "patient-2.json", "patient-3.json"];

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));

type Rows = {
  inserted: number;
  nonNumeric: number;
  conditions: number;
  medicationRequests: number;
};

const NO_CLINICAL = { conditions: 0, medicationRequests: 0 };

const ROWS: Record<string, Rows> = {
  "bp-panel.json": { inserted: 7, nonNumeric: 2, ...NO_CLINICAL },
  "patient-1.json": { inserted: 5, nonNumeric: 0, ...NO_CLINICAL },
  "patient-2.json": { inserted: 5, nonNumeric: 0, ...NO_CLINICAL },
  "patient-3.json": { inserted: 5, nonNumeric: 0, ...NO_CLINICAL },
};

const sha = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Runs the shards in this process, one after another, so output order is fixed. */
const inProcess =
  (ports: ShardPorts): WarehouseIngestDeps["runShards"] =>
  async (shards, job, onOutcome) => {
    for (const files of shards) await ingestShard(files, job, ports, onOutcome);
  };

/**
 * In-memory file system and an ingest port that refuses non-Synthea bundles
 * and dedupes by sha like ingestBundle.
 */
const harness = (files: Record<string, unknown>) => {
  const read = (path: string): JsonRead =>
    !(path in files)
      ? { kind: "missing" }
      : files[path] === INVALID
        ? { kind: "invalid" }
        : { kind: "json", value: files[path] };
  const stored = new Map<string, number>();
  const calls: Array<{ cohortId: string; syntheaVersion: string }> = [];
  const out: string[] = [];
  const err: string[] = [];
  const nameOf = new Map(
    Object.entries(files)
      .filter(([, value]) => value !== INVALID)
      .map(([path, value]) => [sha(value), path]),
  );
  const shardLists: string[][][] = [];
  const ingest: ShardPorts["ingest"] = async (bundle, options): Promise<IngestReport> => {
    calls.push(options);
    if (!isSyntheaBundle(bundle)) {
      return {
        inserted: 0,
        skipped: 0,
        unresolved: [],
        nonNumeric: 0,
        ...NO_CLINICAL,
        alreadyIngested: false,
        rejected: { reason: "not-synthea" },
      };
    }
    const key = sha(bundle);
    const known = stored.get(key);
    if (known !== undefined) {
      return {
        inserted: 0,
        skipped: known,
        unresolved: [],
        nonNumeric: 0,
        ...NO_CLINICAL,
        alreadyIngested: true,
      };
    }
    const name = (nameOf.get(key) ?? "").replace("/cohort/", "");
    const rows = ROWS[name] ?? { inserted: 0, nonNumeric: 0, ...NO_CLINICAL };
    stored.set(key, rows.inserted);
    return { ...rows, skipped: 0, unresolved: [], alreadyIngested: false };
  };
  /** The deps with another ingest port behind the shards. */
  const withIngest = (port: ShardPorts["ingest"]): WarehouseIngestDeps => ({
    listJson: async (dir) =>
      dir === "/cohort"
        ? Object.keys(files)
            .filter((path) => path.startsWith("/cohort/") && path.endsWith(".json"))
            .sort()
        : dir === "/empty"
          ? []
          : null,
    readJson: async (path) => read(path),
    runShards: async (shards, job, onOutcome) => {
      shardLists.push(shards.map((shard) => [...shard]));
      await inProcess({ readJson: async (path) => read(path), ingest: port })(
        shards,
        job,
        onOutcome,
      );
    },
    defaultWorkers: 1,
    cohortSummary: async () => ({
      subjects: stored.size,
      conditions: 2,
      medicationRequests: 3,
      byLoinc: [
        { loinc: "8462-4", display: "Diastolic Blood Pressure", n: 2 },
        { loinc: "8480-6", display: "Systolic Blood Pressure", n: 2 },
      ],
    }),
  });
  const deps = withIngest(ingest);
  const io = {
    stdout: { write: (chunk: string) => void out.push(chunk) },
    stderr: { write: (chunk: string) => void err.push(chunk) },
  };
  return { deps, withIngest, ingest, io, calls, out, err, shardLists };
};

const cohortFiles = (): Record<string, unknown> => ({
  ...Object.fromEntries(FIXTURES.map((name) => [`/cohort/${name}`, fixture(name)])),
  "/cohort/notes.json": { note: "not a bundle" },
});

describe("warehouse:ingest", () => {
  test("ingests every Synthea bundle and prints counts per file and per LOINC", async () => {
    const { deps, io, calls, out, err } = harness(cohortFiles());
    const code = await runWarehouseIngest(["/cohort"], io, deps);

    expect(code).toBe(0);
    expect(err).toEqual([
      "Warning: no manifest.json with a cohort id in /cohort or its parent; ingesting as synthea-v4-seed42.\n",
    ]);
    expect(calls).toEqual(
      FIXTURES.map(() => ({ cohortId: "synthea-v4-seed42", syntheaVersion: "v4.0.0" })),
    );
    expect(out.join("")).toBe(
      [
        "Ingesting 5 files into cohort synthea-v4-seed42 (Synthea v4.0.0) with 1 process",
        "bp-panel.json: inserted 7 rows (2 non-numeric), 0 conditions, 0 medication requests",
        "patient-1.json: inserted 5 rows (0 non-numeric), 0 conditions, 0 medication requests",
        "patient-2.json: inserted 5 rows (0 non-numeric), 0 conditions, 0 medication requests",
        "patient-3.json: inserted 5 rows (0 non-numeric), 0 conditions, 0 medication requests",
        "",
        "Bundles: 4 inserted, 0 already ingested, 0 rejected",
        "Cohort synthea-v4-seed42: 4 subjects",
        "Conditions: 2, medication requests: 3",
        "Numeric observations per LOINC:",
        "  8462-4\t2\tDiastolic Blood Pressure",
        "  8480-6\t2\tSystolic Blood Pressure",
        "",
      ].join("\n"),
    );
  });

  test("a second run skips every bundle and inserts nothing", async () => {
    const { deps, io, out } = harness(cohortFiles());
    await runWarehouseIngest(["/cohort"], io, deps);
    out.length = 0;

    const code = await runWarehouseIngest(["/cohort"], io, deps);
    expect(code).toBe(0);
    expect(out.slice(1, 6)).toEqual([
      "bp-panel.json: already ingested (7 rows)\n",
      "patient-1.json: already ingested (5 rows)\n",
      "patient-2.json: already ingested (5 rows)\n",
      "patient-3.json: already ingested (5 rows)\n",
      "\nBundles: 0 inserted, 4 already ingested, 0 rejected\n",
    ]);
  });

  test("a bundle without the Synthea identifier is rejected and nothing of it is written", async () => {
    const foreign = structuredClone(fixture("patient-2.json")) as {
      entry: Array<{ resource: { resourceType?: string; identifier?: unknown } }>;
    };
    for (const entry of foreign.entry) {
      if (entry.resource.resourceType === "Patient") {
        entry.resource.identifier = [{ system: "urn:example:mrn", value: "7" }];
      }
    }
    const { deps, io, out } = harness({
      ...cohortFiles(),
      "/cohort/zz-foreign.json": foreign,
    });

    const code = await runWarehouseIngest(["/cohort"], io, deps);
    expect(code).toBe(1);
    expect(out.slice(5, 7)).toEqual([
      "zz-foreign.json: rejected (not-synthea)\n",
      "\nBundles: 4 inserted, 0 already ingested, 1 rejected\n",
    ]);
    expect(out).toContain("Cohort synthea-v4-seed42: 4 subjects\n");
  });

  test("a cohort outside the allowlist is refused", async () => {
    const { deps, io, calls, err } = harness(cohortFiles());
    const code = await runWarehouseIngest(["/cohort", "--cohort", "my-cohort"], io, deps);
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(err).toEqual([
      'Cohort "my-cohort" is not allowed. Use one of: open-twin-synthea-trimmed-3, synthea-v4-seed42, synthea-v4-seed4242, synthea-v4-seed9001, synthea-v4-seed42-10k, synthea-v4-seed1001 … synthea-v4-seed1100.\n',
    ]);
  });

  test("--cohort picks another allowed cohort and the manifest sets the version", async () => {
    const { deps, io, calls } = harness({
      "/cohort/patient-1.json": fixture("patient-1.json"),
      "/manifest.json": { syntheaVersion: "v4.0.0-test" },
    });
    const code = await runWarehouseIngest(
      ["/cohort", "--cohort", "open-twin-synthea-trimmed-3"],
      io,
      deps,
    );
    expect(code).toBe(0);
    expect(calls).toEqual([
      { cohortId: "open-twin-synthea-trimmed-3", syntheaVersion: "v4.0.0-test" },
    ]);
  });

  test("the manifest's cohort id must match --cohort", async () => {
    const files = {
      "/cohort/patient-1.json": fixture("patient-1.json"),
      "/manifest.json": { syntheaVersion: "v4.0.0", cohortId: "synthea-v4-seed4242" },
    };
    const wrong = harness(files);
    expect(await runWarehouseIngest(["/cohort"], wrong.io, wrong.deps)).toBe(1);
    expect(wrong.calls).toEqual([]);
    expect(wrong.err).toEqual([
      "Refused, nothing written: /cohort was generated as cohort synthea-v4-seed4242 (manifest.json), not synthea-v4-seed42.\n",
    ]);
    const right = harness(files);
    expect(
      await runWarehouseIngest(
        ["/cohort", "--cohort", "synthea-v4-seed4242"],
        right.io,
        right.deps,
      ),
    ).toBe(0);
    expect(right.err).toEqual([]);
    expect(right.calls).toEqual([
      { cohortId: "synthea-v4-seed4242", syntheaVersion: "v4.0.0" },
    ]);
  });

  test("an empty or missing directory is a clear error", async () => {
    const empty = harness({});
    expect(await runWarehouseIngest(["/empty"], empty.io, empty.deps)).toBe(1);
    expect(empty.err).toEqual(["No FHIR bundles in /empty\n"]);

    const missing = harness({});
    expect(await runWarehouseIngest(["/nope"], missing.io, missing.deps)).toBe(1);
    expect(missing.err).toEqual(["No such directory: /nope\n"]);

    const none = harness({});
    expect(await runWarehouseIngest([], none.io, none.deps)).toBe(1);
    expect(none.err).toEqual([
      "Usage: bun run warehouse:ingest <dir> [--cohort <id>] [--workers <n>]\n",
    ]);
  });

  test("a rejected bundle is reported and the exit code is 1", async () => {
    const { withIngest, io, out } = harness({
      "/cohort/patient-1.json": fixture("patient-1.json"),
    });
    const code = await runWarehouseIngest(
      ["/cohort"],
      io,
      withIngest(async () => ({
        inserted: 0,
        skipped: 0,
        unresolved: [],
        nonNumeric: 0,
        ...NO_CLINICAL,
        alreadyIngested: false,
        rejected: { reason: "ot-quantity-no-code" },
      })),
    );
    expect(code).toBe(1);
    expect(out[1]).toBe("patient-1.json: rejected (ot-quantity-no-code)\n");
    expect(out[2]).toBe("\nBundles: 0 inserted, 0 already ingested, 1 rejected\n");
  });

  test("a *.json that does not parse is rejected and the other files are ingested", async () => {
    const { deps, io, calls, out } = harness({
      ...cohortFiles(),
      "/cohort/broken.json": INVALID,
    });
    const code = await runWarehouseIngest(["/cohort"], io, deps);
    expect(code).toBe(1);
    expect(calls.length).toBe(4);
    expect(out.slice(1, 3)).toEqual([
      "bp-panel.json: inserted 7 rows (2 non-numeric), 0 conditions, 0 medication requests\n",
      "broken.json: rejected (invalid-json)\n",
    ]);
    expect(out).toContain("\nBundles: 4 inserted, 0 already ingested, 1 rejected\n");
  });

  test("a folder of JSON with no FHIR bundle in it is a clear error", async () => {
    const { deps, io, err } = harness({ "/cohort/notes.json": { note: "not a bundle" } });
    expect(await runWarehouseIngest(["/cohort"], io, deps)).toBe(1);
    expect(err.at(-1)).toBe("No FHIR bundles in /cohort\n");
  });

  test("--workers splits the files across that many shards, in turn", async () => {
    const { deps, io, out, shardLists } = harness(cohortFiles());
    expect(await runWarehouseIngest(["/cohort", "--workers", "2"], io, deps)).toBe(0);
    expect(out[0]).toBe(
      "Ingesting 5 files into cohort synthea-v4-seed42 (Synthea v4.0.0) with 2 processes\n",
    );
    expect(shardLists).toEqual([
      [
        ["/cohort/bp-panel.json", "/cohort/patient-1.json", "/cohort/patient-3.json"],
        ["/cohort/notes.json", "/cohort/patient-2.json"],
      ],
    ]);
    expect(out).toContain("\nBundles: 4 inserted, 0 already ingested, 0 rejected\n");
  });

  test("the default is deps.defaultWorkers, never more shards than files", async () => {
    const { deps, io, shardLists } = harness(cohortFiles());
    await runWarehouseIngest(["/cohort"], io, { ...deps, defaultWorkers: 7 });
    expect(shardLists[0]?.length).toBe(5);
  });

  test("--workers must be a whole number from 1", async () => {
    for (const bad of ["0", "-2", "1.5", "many", undefined]) {
      const { deps, io, calls, err } = harness(cohortFiles());
      const argv = ["/cohort", "--workers", ...(bad === undefined ? [] : [bad])];
      expect(await runWarehouseIngest(argv, io, deps)).toBe(1);
      expect(calls).toEqual([]);
      expect(err).toEqual([
        "Usage: bun run warehouse:ingest <dir> [--cohort <id>] [--workers <n>]\n",
      ]);
    }
  });

  test("an ingest that throws once is tried again and counts once", async () => {
    const { withIngest, ingest, io, out } = harness(cohortFiles());
    let thrown = 0;
    const code = await runWarehouseIngest(
      ["/cohort"],
      io,
      withIngest(async (bundle, options) => {
        if (sha(bundle) === sha(fixture("patient-1.json")) && thrown === 0) {
          thrown += 1;
          throw new Error('Unique constraint failed on "subject_ref"');
        }
        return ingest(bundle, options);
      }),
    );
    expect(code).toBe(0);
    expect(thrown).toBe(1);
    expect(out).toContain(
      "patient-1.json: inserted 5 rows (0 non-numeric), 0 conditions, 0 medication requests\n",
    );
    expect(out).toContain("\nBundles: 4 inserted, 0 already ingested, 0 rejected\n");
  });

  test("a bundle whose ingest throws is rejected with a fixed reason and the run goes on", async () => {
    const { withIngest, ingest, io, out } = harness(cohortFiles());
    const code = await runWarehouseIngest(
      ["/cohort"],
      io,
      withIngest(async (bundle, options) => {
        if (sha(bundle) === sha(fixture("patient-2.json"))) {
          throw new Error(
            'PrismaClientKnownRequestError: Unique constraint failed on "sha"',
          );
        }
        return ingest(bundle, options);
      }),
    );
    expect(code).toBe(1);
    expect(out.join("")).toContain("patient-2.json: rejected (ingest-failed)\n");
    expect(out.join("")).not.toContain("Prisma");
    expect(out.join("")).toContain(
      "patient-3.json: inserted 5 rows (0 non-numeric), 0 conditions, 0 medication requests\n",
    );
    expect(out.join("")).toContain(
      "Bundles: 3 inserted, 0 already ingested, 1 rejected\n",
    );
    expect(out.join("")).toContain("Cohort synthea-v4-seed42: 3 subjects\n");
  });

  test("already ingested comes from the report flag, even for a bundle with no rows", async () => {
    const { withIngest, io, out } = harness({
      "/cohort/patient-1.json": fixture("patient-1.json"),
    });
    const ingest = async (): Promise<IngestReport> => ({
      inserted: 0,
      skipped: 0,
      unresolved: [],
      nonNumeric: 0,
      ...NO_CLINICAL,
      alreadyIngested: false,
    });
    await runWarehouseIngest(["/cohort"], io, withIngest(ingest));
    expect(out[1]).toBe(
      "patient-1.json: inserted 0 rows (0 non-numeric), 0 conditions, 0 medication requests\n",
    );

    out.length = 0;
    await runWarehouseIngest(
      ["/cohort"],
      io,
      withIngest(async () => ({ ...(await ingest()), alreadyIngested: true })),
    );
    expect(out[1]).toBe("patient-1.json: already ingested (0 rows)\n");
    expect(out[2]).toBe("\nBundles: 0 inserted, 1 already ingested, 0 rejected\n");
  });
});
