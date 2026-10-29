import { describe, expect, test } from "bun:test";

import { randomFor, type Random } from "@/infrastructure/seeded-random";

import {
  dropBeats,
  insertSpuriousBeats,
  intervalsOf,
  jitterBeats,
  NO_PERTURBATION,
  perturbBeats,
} from "./perturb";

const sequence = (values: readonly number[]): Random => {
  let i = 0;
  return () => {
    const value = values[i % values.length];
    i += 1;
    return value;
  };
};

const BEATS = {
  beatTimesMs: [0, 800, 1600, 2000, 2800],
  labels: ["sinus", "sinus", "af", "af"] as const,
};

describe("dropBeats", () => {
  test("a dropped inner beat merges its intervals; the label of the kept end beat stays", () => {
    // Draws for beats 1..3 (first and last always kept): drop beat 2.
    const random = sequence([0.9, 0.0, 0.9]);
    expect(dropBeats(BEATS, 0.5, random)).toEqual({
      beatTimesMs: [0, 800, 2000, 2800],
      labels: ["sinus", "af", "af"],
    });
  });

  test("share 0 keeps every beat", () => {
    expect(dropBeats(BEATS, 0, sequence([0]))).toEqual({
      beatTimesMs: BEATS.beatTimesMs,
      labels: [...BEATS.labels],
    });
  });
});

describe("insertSpuriousBeats", () => {
  test("splits an interval at 20 to 80 % of it, both parts keep its label", () => {
    // Per interval: insert draw, then position draw.
    const random = sequence([0.9, 0.5, 0.0, 0.5, 0.9, 0.5, 0.9, 0.5]);
    expect(insertSpuriousBeats(BEATS, 0.5, random)).toEqual({
      beatTimesMs: [0, 800, 1200, 1600, 2000, 2800],
      labels: ["sinus", "sinus", "sinus", "af", "af"],
    });
  });
});

describe("jitterBeats and intervalsOf", () => {
  test("jitter keeps beats in order and labels unchanged", () => {
    const jittered = jitterBeats(
      { beatTimesMs: [0, 1, 2, 3], labels: ["af", "af", "af"] },
      50,
      randomFor(1, "jitter"),
    );
    expect(jittered.labels).toEqual(["af", "af", "af"]);
    expect(intervalsOf(jittered.beatTimesMs).every((rr) => rr >= 1)).toBe(true);
  });

  test("intervals of rounded times", () => {
    expect(intervalsOf([0, 800.4, 1600.6, 1601])).toEqual([800, 801, 1]);
  });
});

describe("perturbBeats", () => {
  test("no perturbation returns the beats unchanged", () => {
    expect(perturbBeats(BEATS, NO_PERTURBATION, sequence([0]))).toBe(BEATS);
  });

  test("seeded: the same seed gives the same beats", () => {
    const level = { dropShare: 0.2, spuriousShare: 0.2, jitterSdMs: 10 };
    const a = perturbBeats(BEATS, level, randomFor(7, "p"));
    const b = perturbBeats(BEATS, level, randomFor(7, "p"));
    expect(a).toEqual(b);
    expect(a.beatTimesMs.length).toBe(a.labels.length + 1);
  });
});
