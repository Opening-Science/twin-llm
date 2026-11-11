import { describe, expect, test } from "bun:test";

import { FITTED_ATLASES } from "../../packages/anatomy/fitted-atlases";
import { checkPin, MAX_DEVIATION_M, maxDeviation, quantiseJobs } from "./quantise-plan";

describe("quantiseJobs", () => {
  test("every body × atlas, from Blender's output to the served file", () => {
    const jobs = quantiseJobs("/a");
    expect(jobs).toHaveLength(6);
    expect(jobs[0]).toEqual({
      bodyId: "anny-adult-m",
      atlasId: "bodyparts3d",
      source: "/a/fitted/anny-adult-m.bodyparts3d.fitted.glb",
      out: "/a/fitted/anny-adult-m.bodyparts3d.fitted.quantised.glb",
      pin: FITTED_ATLASES["anny-adult-m"].bodyparts3d,
    });
  });

  test("narrows to one pair", () => {
    const jobs = quantiseJobs("/a", ["anny-adult-f"], ["hra-m"]);
    expect(jobs.map((job) => job.out)).toEqual([
      "/a/fitted/anny-adult-f.hra-m.fitted.quantised.glb",
    ]);
  });
});

describe("maxDeviation", () => {
  test("is the largest vertex distance", () => {
    expect(maxDeviation([0, 0, 0, 1, 1, 1], [0, 0, 0, 1, 1, 1])).toBe(0);
    expect(maxDeviation([0, 0, 0, 1, 1, 1], [0.0003, 0, 0, 1, 1.0004, 1])).toBeCloseTo(
      0.0004,
      9,
    );
    expect(maxDeviation([0, 0, 0], [0.0006, 0.0008, 0])).toBeCloseTo(0.001, 9);
  });

  test("a dropped vertex or a NaN never passes the 1 mm check", () => {
    expect(maxDeviation([0, 0, 0, 1, 1, 1], [0, 0, 0])).toBe(Infinity);
    expect(maxDeviation([0, 0, 0], [Number.NaN, 0, 0]) <= MAX_DEVIATION_M).toBe(false);
  });
});

describe("checkPin", () => {
  const pin = { bytes: 3, sha256: "a".repeat(64) };
  test("matches only on both size and hash", () => {
    expect(checkPin(pin, pin)).toEqual({ kind: "match" });
    expect(checkPin({ bytes: 4, sha256: pin.sha256 }, pin).kind).toBe("mismatch");
    expect(checkPin({ bytes: 3, sha256: "b".repeat(64) }, pin)).toEqual({
      kind: "mismatch",
      bytes: 3,
      sha256: "b".repeat(64),
    });
  });
});
