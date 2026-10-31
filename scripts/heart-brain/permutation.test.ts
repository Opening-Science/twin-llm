import { describe, expect, test } from "bun:test";

import { randomFor } from "../synthetic-wearables/random";

import {
  day,
  person,
} from "../../packages/query-tools/event-rates/fixtures.test-helpers";
import { shuffleAfOnsets, spreadOf } from "./permutation";

describe("shuffleAfOnsets", () => {
  test("moves AF onsets inside each person's own follow-up from age 45", () => {
    const people = Array.from({ length: 50 }, (_, index) =>
      person(`p${index}`, {
        birth: "1940-01-01",
        end: "2020-01-01",
        onset: { af: "2010-01-01" },
      }),
    );
    const shuffled = shuffleAfOnsets(people, randomFor(3, "shuffle"));
    const days = shuffled.map((p) => p.onset.af ?? Number.NaN);
    expect(days.every((at) => at >= day("1985-01-01") && at < day("2020-01-01"))).toBe(
      true,
    );
    expect(new Set(days).size).toBeGreaterThan(40);
  });

  test("people without AF and people who never reach 45 are handled", () => {
    const noAf = person("n");
    const young = person("y", { birth: "2000-01-01", onset: { af: "2010-01-01" } });
    const [a, b] = shuffleAfOnsets([noAf, young], randomFor(3, "shuffle"));
    expect(a).toBe(noAf);
    expect(b?.onset.af).toBeGreaterThanOrEqual(day("2000-01-01"));
    expect(b?.onset.af).toBeLessThan(day("2026-01-01"));
  });

  test("the same seed gives the same shuffle", () => {
    const people = [person("p", { onset: { af: "2010-01-01" } })];
    expect(shuffleAfOnsets(people, randomFor(9, "k"))).toEqual(
      shuffleAfOnsets(people, randomFor(9, "k")),
    );
  });
});

describe("spreadOf", () => {
  test("mean and percentiles of the values that are not null", () => {
    const values = [...Array.from({ length: 40 }, (_, i) => i + 1), null];
    expect(spreadOf(values)).toEqual({ mean: 20.5, low: 2, high: 40, runs: 40 });
    expect(spreadOf([null])).toBeNull();
  });
});
