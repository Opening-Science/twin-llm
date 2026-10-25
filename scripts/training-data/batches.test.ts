import { describe, expect, test } from "bun:test";

import { batchCohort } from "../synthea/cohort-presets";

import {
  batchPaths,
  databaseNameOf,
  databaseRefusal,
  envFileValue,
  formatBytes,
  formatDuration,
  ingestCounts,
  parseBatchArgs,
  parseBatchRange,
  rejectedReasons,
  stepPlan,
  wearableCounts,
  workManifest,
} from "./batches";

const seedsOf = (spec: string) => {
  const batches = parseBatchRange(spec);
  return typeof batches === "string" ? batches : batches.map((batch) => batch.seed);
};

const batch1001 = () => {
  const batch = batchCohort(1001);
  if (batch === null) throw new Error("1001 is a batch");
  return batch;
};

describe("parseBatchRange", () => {
  test("ranges, single seeds and lists, in seed order without repeats", () => {
    expect(seedsOf("1001-1003")).toEqual([1001, 1002, 1003]);
    expect(seedsOf("1100")).toEqual([1100]);
    expect(seedsOf("1010,1001-1002, 1002")).toEqual([1001, 1002, 1010]);
  });

  test("roles come from the batch family", () => {
    const batches = parseBatchRange("1099-1100");
    if (typeof batches === "string") throw new Error(batches);
    expect(batches.map((batch) => [batch.cohortId, batch.role])).toEqual([
      ["synthea-v4-seed1099", "training"],
      ["synthea-v4-seed1100", "held-out"],
    ]);
  });

  test("refuses seeds outside 1001 to 1100 and malformed specs", () => {
    expect(seedsOf("1000-1002")).toBe(
      "--batches are seeds 1001 to 1100 (got: 1000-1002).",
    );
    expect(seedsOf("1100-1101")).toBe(
      "--batches are seeds 1001 to 1100 (got: 1100-1101).",
    );
    expect(seedsOf("42")).toBe("--batches are seeds 1001 to 1100 (got: 42).");
    expect(seedsOf("1005-1001")).toBe("--batches range 1005-1001 runs backwards.");
    expect(seedsOf("1-2-3")).toBe(
      "--batches must look like 1001-1010 or 1001,1005 (got: 1-2-3).",
    );
    expect(seedsOf("1001-")).toBe(
      "--batches must look like 1001-1010 or 1001,1005 (got: 1001-).",
    );
    expect(seedsOf("batch-001")).toBe(
      "--batches must look like 1001-1010 or 1001,1005 (got: batch-001).",
    );
  });
});

describe("parseBatchArgs", () => {
  test("defaults", () => {
    const args = parseBatchArgs(["--batches", "1001"]);
    if (typeof args === "string") throw new Error(args);
    expect({ ...args, batches: args.batches.map((batch) => batch.seed) }).toEqual({
      batches: [1001],
      archives: "../synthea-1m/batches",
      work: ".synthea/batches",
      out: "training-data/out",
      keep: false,
    });
  });

  test("flags", () => {
    const args = parseBatchArgs([
      "--batches",
      "1100",
      "--archives",
      "/data/batches",
      "--work",
      "/scratch",
      "--out",
      "out",
      "--keep",
    ]);
    if (typeof args === "string") throw new Error(args);
    expect([args.archives, args.work, args.out, args.keep]).toEqual([
      "/data/batches",
      "/scratch",
      "out",
      true,
    ]);
  });

  test("usage and a flag without a value", () => {
    expect(parseBatchArgs([])).toBe(
      "Usage: bun run training:batches -- --batches 1001-1010 [--archives <dir>] [--work <dir>] [--out <dir>] [--keep]",
    );
    expect(parseBatchArgs(["--batches", "1001", "--work"])).toBe(
      "--work needs a directory.",
    );
    expect(parseBatchArgs(["--batches", "1001", "--out", "--keep"])).toBe(
      "--out needs a directory.",
    );
  });
});

describe("batchPaths", () => {
  test("the fhir dir sits next to its manifest, as synthea:generate writes it", () => {
    expect(
      batchPaths(batch1001(), { archives: "arch", work: "work", out: "out" }),
    ).toEqual({
      archive: "arch/batch-001.tar.zst",
      archiveManifest: "arch/batch-001.manifest.json",
      dir: "work/synthea-v4-seed1001",
      fhir: "work/synthea-v4-seed1001/fhir",
      wearables: "work/synthea-v4-seed1001/wearables",
      manifest: "work/synthea-v4-seed1001/manifest.json",
      unpacked: "work/synthea-v4-seed1001/.unpacked",
      records: "out/synthea-v4-seed1001.jsonl",
      meta: "out/synthea-v4-seed1001.meta.jsonl",
      conversationManifest: "out/synthea-v4-seed1001.manifest.json",
      logs: "work/logs",
    });
  });
});

describe("stepPlan", () => {
  test("a new batch runs every step", () => {
    expect(stepPlan({ done: false, unpacked: false, keep: false })).toEqual([
      "unpack",
      "wearables",
      "ingest fhir",
      "ingest wearables",
      "conversations",
      "clear rows",
      "remove files",
    ]);
  });

  test("--keep keeps the files, and a kept unpacked copy is reused", () => {
    expect(stepPlan({ done: false, unpacked: true, keep: true })).toEqual([
      "wearables",
      "ingest fhir",
      "ingest wearables",
      "conversations",
      "clear rows",
    ]);
  });

  test("a finished batch only clears its leftovers", () => {
    expect(stepPlan({ done: true, unpacked: true, keep: false })).toEqual([
      "clear rows",
      "remove files",
    ]);
    expect(stepPlan({ done: true, unpacked: false, keep: true })).toEqual(["clear rows"]);
  });
});

describe("workManifest", () => {
  const archived = {
    syntheaVersion: "v4.0.0",
    seed: 1001,
    clinicianSeed: 2001,
    population: 10000,
    state: "Massachusetts",
  };

  test("adds the cohort id to the batch manifest", () => {
    expect(workManifest(batch1001(), archived)).toEqual({
      ...archived,
      cohortId: "synthea-v4-seed1001",
    });
  });

  test("refuses a manifest from another batch or none", () => {
    expect(workManifest(batch1001(), { ...archived, seed: 1002 })).toBe(
      "The batch manifest for batch-001.tar.zst does not match seed 1001, clinician seed 2001, N=10000.",
    );
    expect(workManifest(batch1001(), null)).toBe("No batch manifest for seed 1001.");
  });
});

describe("database guard", () => {
  test("envFileValue reads one key, quoted or not", () => {
    const text =
      '# DATABASE_URL=commented\nDATA_MODE=synthetic\nDATABASE_URL="postgresql://u:p@h:5432/dev"\n';
    expect(envFileValue(text, "DATABASE_URL")).toBe("postgresql://u:p@h:5432/dev");
    expect(envFileValue("DATABASE_URL=postgresql://h/x", "DATABASE_URL")).toBe(
      "postgresql://h/x",
    );
    expect(envFileValue("DATA_MODE=synthetic", "DATABASE_URL")).toBeNull();
  });

  test("databaseNameOf", () => {
    expect(
      databaseNameOf("postgresql://u:p@127.0.0.1:5432/twin_llm_training?schema=public"),
    ).toBe("twin_llm_training");
    expect(databaseNameOf("postgresql://127.0.0.1:5432")).toBeNull();
    expect(databaseNameOf("not a url")).toBeNull();
  });

  test("refuses the dev database by name, on any host or user", () => {
    const dev = "postgresql://user:password@127.0.0.1:5432/twin_llm_synthetic";
    expect(
      databaseRefusal("postgresql://postgres:x@localhost:5433/twin_llm_synthetic", [
        null,
        dev,
      ]),
    ).toBe(
      "Refused: twin_llm_synthetic is the dev database. Point DATABASE_URL in .env.training at a database for training cohorts only.",
    );
    expect(
      databaseRefusal("postgresql://u@127.0.0.1:5432/twin_llm_training", [dev, null]),
    ).toBeNull();
    expect(databaseRefusal("postgresql://u@127.0.0.1:5432", [dev])).toBe(
      "DATABASE_URL in .env.training names no database.",
    );
  });
});

describe("step output", () => {
  test("ingestCounts reads the ingest summary", () => {
    expect(
      ingestCounts(
        "a.json: inserted 3 rows\n\nBundles: 11416 inserted, 2 already ingested, 1 rejected\n",
      ),
    ).toEqual({ inserted: 11416, already: 2, rejected: 1 });
    expect(ingestCounts("Refused, nothing written: a.json (not Synthea)\n")).toBeNull();
  });

  test("rejectedReasons counts the reasons, most first", () => {
    expect(
      rejectedReasons(
        [
          "a.json: rejected (ot-unit-policy)",
          "b.json: inserted 3 rows (0 non-numeric)",
          "c.json: rejected (ot-quantity-no-code)",
          "d.json: rejected (ot-unit-policy)",
          "",
          "Bundles: 1 inserted, 0 already ingested, 3 rejected",
        ].join("\n"),
      ),
    ).toBe("2 ot-unit-policy, 1 ot-quantity-no-code");
    expect(rejectedReasons("Bundles: 1 inserted, 0 already ingested, 0 rejected\n")).toBe(
      "",
    );
  });

  test("wearableCounts reads the generator summary", () => {
    expect(
      wearableCounts(
        "Synthetic wearables written to x\nSubjects: 10000, deceased left out: 1416, other files: 0\nReadings: 4500000 over 90 days ending 2026-10-01\n",
      ),
    ).toEqual({ subjects: 10000, readings: 4500000 });
    expect(wearableCounts("")).toBeNull();
  });

  test("formatDuration", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(187_000)).toBe("3m 07s");
    expect(formatDuration(3_725_000)).toBe("1h 02m 05s");
  });

  test("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(444_700)).toBe("444.7 KB");
    expect(formatBytes(41_234_000_000)).toBe("41.2 GB");
  });
});
