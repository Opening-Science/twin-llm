import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { IngestReport } from "../../packages/warehouse/ingest-report";

import { runWarehouseIngest, type JsonRead, type WarehouseIngestDeps } from "./ingest";

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

/** In-memory file system and an ingest port that dedupes by sha like ingestBundle. */
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
  const deps: WarehouseIngestDeps = {
    listJson: async (dir) =>
      dir === "/cohort"
        ? Object.keys(files)
            .filter((path) => path.startsWith("/cohort/") && path.endsWith(".json"))
            .sort()
        : dir === "/empty"
          ? []
          : null,
    readJson: async (path) => read(path),
    ingest: async (bundle, options): Promise<IngestReport> => {
      calls.push(options);
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
    },
    cohortSummary: async () => ({
      subjects: stored.size,
      conditions: 2,
      medicationRequests: 3,
      byLoinc: [
        { loinc: "8462-4", display: "Diastolic Blood Pressure", n: 2 },
        { loinc: "8480-6", display: "Systolic Blood Pressure", n: 2 },
      ],
    }),
  };
  const io = {
    stdout: { write: (chunk: string) => void out.push(chunk) },
    stderr: { write: (chunk: string) => void err.push(chunk) },
  };
  return { deps, io, calls, out, err };
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
        "Ingesting 4 bundles into cohort synthea-v4-seed42 (Synthea v4.0.0)",
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

  test("a bundle without the Synthea identifier stops the run before any write", async () => {
    const foreign = structuredClone(fixture("patient-2.json")) as {
      entry: Array<{ resource: { resourceType?: string; identifier?: unknown } }>;
    };
    for (const entry of foreign.entry) {
      if (entry.resource.resourceType === "Patient") {
        entry.resource.identifier = [{ system: "urn:example:mrn", value: "7" }];
      }
    }
    const { deps, io, calls, out, err } = harness({
      ...cohortFiles(),
      "/cohort/zz-foreign.json": foreign,
    });

    const code = await runWarehouseIngest(["/cohort"], io, deps);
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(out).toEqual([]);
    expect(err).toEqual(["Refused, nothing written: zz-foreign.json (not Synthea)\n"]);
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
    expect(none.err).toEqual(["Usage: bun run warehouse:ingest <dir> [--cohort <id>]\n"]);
  });

  test("a rejected bundle is reported and the exit code is 1", async () => {
    const { deps, io, out } = harness({
      "/cohort/patient-1.json": fixture("patient-1.json"),
    });
    const code = await runWarehouseIngest(["/cohort"], io, {
      ...deps,
      ingest: async () => ({
        inserted: 0,
        skipped: 0,
        unresolved: [],
        nonNumeric: 0,
        ...NO_CLINICAL,
        alreadyIngested: false,
        rejected: { reason: "ot-quantity-no-code" },
      }),
    });
    expect(code).toBe(1);
    expect(out[1]).toBe("patient-1.json: rejected (ot-quantity-no-code)\n");
    expect(out[2]).toBe("\nBundles: 0 inserted, 0 already ingested, 1 rejected\n");
  });

  test("a *.json that does not parse is refused and nothing is written", async () => {
    const { deps, io, calls, out, err } = harness({
      ...cohortFiles(),
      "/cohort/broken.json": INVALID,
    });
    const code = await runWarehouseIngest(["/cohort"], io, deps);
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(out).toEqual([]);
    expect(err).toEqual(["Refused, nothing written: broken.json (invalid JSON)\n"]);
  });

  test("a bundle whose ingest throws is rejected with a fixed reason and the run goes on", async () => {
    const { deps, io, out } = harness(cohortFiles());
    const code = await runWarehouseIngest(["/cohort"], io, {
      ...deps,
      ingest: async (bundle, options) => {
        if (sha(bundle) === sha(fixture("patient-2.json"))) {
          throw new Error(
            'PrismaClientKnownRequestError: Unique constraint failed on "sha"',
          );
        }
        return deps.ingest(bundle, options);
      },
    });
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
    const { deps, io, out } = harness({
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
    await runWarehouseIngest(["/cohort"], io, { ...deps, ingest });
    expect(out[1]).toBe(
      "patient-1.json: inserted 0 rows (0 non-numeric), 0 conditions, 0 medication requests\n",
    );

    out.length = 0;
    await runWarehouseIngest(["/cohort"], io, {
      ...deps,
      ingest: async () => ({ ...(await ingest()), alreadyIngested: true }),
    });
    expect(out[1]).toBe("patient-1.json: already ingested (0 rows)\n");
    expect(out[2]).toBe("\nBundles: 0 inserted, 1 already ingested, 0 rejected\n");
  });
});
