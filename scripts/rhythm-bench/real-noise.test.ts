import { describe, expect, test } from "bun:test";

import { labelledSegments } from "./afdb-series";
import { type AfdbRecordInput, recordWindows } from "./benchmark";
import { intervalsOf } from "./perturb";
import {
  perturbedRecordWindows,
  realNoiseLevels,
  realRecordSeed,
  segmentBeats,
} from "./real-noise";
import { NOISE_LEVELS } from "./sim-grid";

const level = (id: string) => {
  const found = NOISE_LEVELS.find((each) => each.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

/** A synthetic annotated record at 250 Hz: sinus-like steps, then AF-like ones, with a 4 s gap. */
const fakeRecord = (record: string, length: number): AfdbRecordInput => {
  const steps = Array.from({ length }, (_, i) =>
    i === Math.floor(length / 3)
      ? 1000
      : i < length / 2
        ? 200 + (i % 3)
        : 120 + ((i * 37) % 97),
  );
  const beats = steps.reduce<number[]>((out, step) => {
    out.push((out.at(-1) ?? 0) + step);
    return out;
  }, []);
  return {
    record,
    beatAnnotator: "qrs",
    samplingHz: 250,
    hasSignalFile: false,
    beats,
    rhythmChanges: [
      { sample: 0, rhythm: "N" },
      { sample: beats[Math.floor(length / 2)], rhythm: "AFIB" },
    ],
  };
};

describe("segmentBeats", () => {
  test("its intervals are the segment's intervals", () => {
    const record = fakeRecord("r", 600);
    const segments = labelledSegments(
      record.beats,
      record.rhythmChanges,
      record.samplingHz,
    );
    expect(segments.length).toBe(2);
    for (const segment of segments) {
      const beats = segmentBeats(segment);
      expect(intervalsOf(beats.beatTimesMs)).toEqual([...segment.rrMs]);
      expect(beats.labels).toEqual(segment.rhythms);
    }
  });
});

describe("perturbedRecordWindows", () => {
  test("level none is the database windows unchanged", () => {
    const record = fakeRecord("r", 900);
    const none = perturbedRecordWindows(record, level("none"));
    expect(none.missed).toBe(0);
    expect(none.spurious).toBe(0);
    expect(none.rows.map(({ noise: _noise, ...row }) => row)).toEqual(
      recordWindows(record),
    );
    expect(none.rows.every((row) => row.noise === "none")).toBe(true);
  });

  test("seeded per record: same record, same windows; another record name, other noise", () => {
    const heavy = level("heavy");
    const a = perturbedRecordWindows(fakeRecord("r1", 900), heavy);
    const b = perturbedRecordWindows(fakeRecord("r1", 900), heavy);
    const c = perturbedRecordWindows(fakeRecord("r2", 900), heavy);
    expect(a).toEqual(b);
    expect(realRecordSeed("r1")).not.toBe(realRecordSeed("r2"));
    expect(c.rows.map((row) => row.rr)).not.toEqual(a.rows.map((row) => row.rr));
  });

  test("missed and spurious beats come at the level's shares", () => {
    for (const id of ["light", "heavy"]) {
      const noise = level(id);
      const result = perturbedRecordWindows(fakeRecord("long", 60_000), noise);
      expect(Math.abs(result.missed / result.beats - noise.dropShare)).toBeLessThan(
        0.004,
      );
      // Spurious beats go into the intervals left after the missed ones.
      expect(
        Math.abs(
          result.spurious / result.beats - noise.spuriousShare * (1 - noise.dropShare),
        ),
      ).toBeLessThan(0.004);
    }
  });
});

describe("realNoiseLevels", () => {
  test("one summary per level, records as clusters, deterministic", () => {
    const records = [fakeRecord("r1", 900), fakeRecord("r2", 700)];
    const a = realNoiseLevels(records, NOISE_LEVELS, 20, 5);
    const b = realNoiseLevels(records, NOISE_LEVELS, 20, 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.levels.map((each) => each.noise)).toEqual(["none", "light", "heavy"]);
    expect(a.levels.every((each) => each.summary.nClusters === 2)).toBe(true);
    expect(a.rows.filter((row) => row.noise === "none")).toHaveLength(
      a.levels[0].summary.nWindows,
    );
  });
});
