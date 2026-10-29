import { describe, expect, test } from "bun:test";

import { mulberry32 } from "@/infrastructure/seeded-random";

import {
  type BeatLabel,
  ectopicCandidates,
  insertEctopicBeats,
  pickEctopicSites,
  shuffled,
} from "./ectopic-beats";

const sinus = (n: number): BeatLabel[] => Array.from({ length: n }, () => "sinus");

describe("shuffled", () => {
  test("keeps every item and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5];
    const output = shuffled(input, mulberry32(3));
    expect([...output].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  test("a draw of 0 every time keeps the order", () => {
    expect(shuffled(["a", "b", "c"], () => 0)).toEqual(["a", "b", "c"]);
  });
});

describe("ectopicCandidates", () => {
  test("not the first or last two intervals, and only sinus followed by sinus", () => {
    expect(ectopicCandidates(sinus(6))).toEqual([1, 2, 3]);
    expect(
      ectopicCandidates(["sinus", "sinus", "af", "sinus", "sinus", "sinus", "sinus"]),
    ).toEqual([3, 4]);
  });
});

describe("pickEctopicSites", () => {
  test("sites are at least 3 apart", () => {
    const sites = pickEctopicSites(sinus(60), 8, mulberry32(2)).sort((a, b) => a - b);
    expect(sites.length).toBe(8);
    sites.slice(1).forEach((site, i) => expect(site - sites[i] >= 3).toBe(true));
  });

  test("too few places is an error", () => {
    expect(() => pickEctopicSites(sinus(6), 2, mulberry32(2))).toThrow(
      "only 1 places for 2 ectopic beats",
    );
  });
});

describe("insertEctopicBeats", () => {
  const intervals = { rrMs: [1000, 1000, 1000, 1000, 1000], labels: sinus(5) };
  const plan = { pacPrematurity: 0.25, pvcPrematurity: 0.3 };

  test("one PVC: 700 then 1300, the sum of the two kept", () => {
    const out = insertEctopicBeats(
      intervals,
      { ...plan, pacCount: 0, pvcCount: 1 },
      () => 0,
    );
    expect(out.rrMs).toEqual([1000, 700, 1300, 1000, 1000]);
    expect(out.labels).toEqual(["sinus", "pvc", "sinus", "sinus", "sinus"]);
  });

  test("one PAC: 750 then an ordinary 1000", () => {
    const out = insertEctopicBeats(
      intervals,
      { ...plan, pacCount: 1, pvcCount: 0 },
      () => 0,
    );
    expect(out.rrMs).toEqual([1000, 750, 1000, 1000, 1000]);
    expect(out.labels).toEqual(["sinus", "pac", "sinus", "sinus", "sinus"]);
  });

  test("no ectopy returns the intervals unchanged", () => {
    expect(
      insertEctopicBeats(intervals, { ...plan, pacCount: 0, pvcCount: 0 }, () => 0),
    ).toBe(intervals);
  });
});
