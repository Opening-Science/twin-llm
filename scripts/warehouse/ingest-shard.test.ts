import { describe, expect, test } from "bun:test";

import { emptyReport } from "../../packages/warehouse/ingest-report";

import { ingestFile, missingOutcomes, outcomeLine, splitShards } from "./ingest-shard";
import { parseOutcome } from "./spawn-shards";

const JOB = { cohortId: "synthea-v4-seed1001", syntheaVersion: "v4.0.0" };

describe("splitShards", () => {
  test("deals files out in turn and never makes more shards than files", () => {
    expect(splitShards(["a", "b", "c", "d", "e"], 2)).toEqual([
      ["a", "c", "e"],
      ["b", "d"],
    ]);
    expect(splitShards(["a", "b"], 4)).toEqual([["a"], ["b"]]);
    expect(splitShards([], 4)).toEqual([[]]);
  });
});

describe("ingestFile", () => {
  test("parses once and hands that value to ingest", async () => {
    const reads: string[] = [];
    const bundle = { resourceType: "Bundle", entry: [] };
    const seen: unknown[] = [];
    const outcome = await ingestFile("/d/p.json", JOB, {
      readJson: async (path) => {
        reads.push(path);
        return { kind: "json", value: bundle };
      },
      ingest: async (value) => {
        seen.push(value);
        return emptyReport({ inserted: 3 });
      },
    });
    expect(reads).toEqual(["/d/p.json"]);
    expect(seen).toEqual([bundle]);
    expect(outcome).toEqual({
      path: "/d/p.json",
      kind: "report",
      report: emptyReport({ inserted: 3 }),
    });
  });

  test("JSON that is not a bundle is skipped without an ingest", async () => {
    const outcome = await ingestFile("/d/manifest.json", JOB, {
      readJson: async () => ({ kind: "json", value: { cohortId: "x" } }),
      ingest: async () => {
        throw new Error("not called");
      },
    });
    expect(outcome).toEqual({ path: "/d/manifest.json", kind: "not-bundle" });
  });

  test("two throws are a fixed reason, never the message", async () => {
    let tries = 0;
    const outcome = await ingestFile("/d/p.json", JOB, {
      readJson: async () => ({ kind: "json", value: { resourceType: "Bundle" } }),
      ingest: async () => {
        tries += 1;
        throw new Error("password=hunter2 at 127.0.0.1");
      },
    });
    expect(tries).toBe(2);
    expect(outcome).toEqual({
      path: "/d/p.json",
      kind: "report",
      report: emptyReport({ rejected: { reason: "ingest-failed" } }),
    });
  });
});

describe("worker outcomes", () => {
  test("files a worker never reported are ingest-failed", () => {
    expect(missingOutcomes(["/d/a.json", "/d/b.json"], new Set(["/d/a.json"]))).toEqual([
      {
        path: "/d/b.json",
        kind: "report",
        report: emptyReport({ rejected: { reason: "ingest-failed" } }),
      },
    ]);
  });

  test("a line is read only for a file of that shard, with a valid report", () => {
    const files = new Set(["/d/a.json"]);
    const report = emptyReport({ inserted: 2, nonNumeric: 1 });
    expect(
      parseOutcome(JSON.stringify({ path: "/d/a.json", kind: "report", report }), files),
    ).toEqual({ path: "/d/a.json", kind: "report", report });
    expect(
      parseOutcome(JSON.stringify({ path: "/d/a.json", kind: "not-bundle" }), files),
    ).toEqual({ path: "/d/a.json", kind: "not-bundle" });
    expect(
      parseOutcome(JSON.stringify({ path: "/d/z.json", kind: "report", report }), files),
    ).toBeNull();
    expect(
      parseOutcome(
        JSON.stringify({ path: "/d/a.json", kind: "report", report: { inserted: -1 } }),
        files,
      ),
    ).toBeNull();
    expect(parseOutcome("Prisma warning: something", files)).toBeNull();
  });

  test("outcome lines keep the form run-batches reads", () => {
    expect(
      outcomeLine({
        path: "/d/a.json",
        kind: "report",
        report: emptyReport({ rejected: { reason: "ot-unit-policy" } }),
      }),
    ).toBe("a.json: rejected (ot-unit-policy)");
    expect(
      outcomeLine({
        path: "/d/a.json",
        kind: "report",
        report: emptyReport({ skipped: 9, alreadyIngested: true }),
      }),
    ).toBe("a.json: already ingested (9 rows)");
    expect(outcomeLine({ path: "/d/m.json", kind: "not-bundle" })).toBeNull();
  });
});
