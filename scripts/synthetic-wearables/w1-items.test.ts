import { describe, expect, test } from "bun:test";

import { randomFor } from "../../infrastructure/seeded-random";
import {
  SOURCE_TOLERANCE,
  withinTolerance,
} from "../../infrastructure/wearable-source-rules";

import {
  countW1,
  dealStrata,
  DEV_OPTIONS,
  expectedFor,
  FIXED_ORDER,
  generateW1,
  isIdentifiable,
  STRATA,
  W1_DEFAULTS,
  W1_PROBES,
  W1_QUOTAS,
  type W1Item,
  type W1Metric,
} from "./w1-items";

const w1 = generateW1(W1_DEFAULTS);
const core = w1.filter((item) => item.stratum !== "construct_mismatch");

const onDay = (item: W1Item): readonly W1Metric[] =>
  item.metrics.filter((metric) => metric.date === item.askedDay);

describe("generateW1", () => {
  test("the registered counts: 240 core items over 80 people, and 24 probes", () => {
    const counts = countW1(w1);
    expect(core).toHaveLength(240);
    expect(counts.people).toBe(80);
    expect(counts.byStratum).toEqual({ ...W1_QUOTAS, construct_mismatch: W1_PROBES });
  });

  test("every person has three core items, from three strata", () => {
    const people = [...new Set(core.map((item) => item.personId))];
    for (const person of people) {
      const items = core.filter((item) => item.personId === person);
      expect(items).toHaveLength(3);
      expect(new Set(items.map((item) => item.stratum)).size).toBe(3);
    }
  });

  test("the same seed gives the same items; another seed others", () => {
    expect(generateW1(W1_DEFAULTS)).toEqual(w1);
    expect(generateW1({ ...W1_DEFAULTS, seed: 1 })).not.toEqual(w1);
  });

  test("every item is identifiable", () => {
    for (const item of w1) expect(isIdentifiable(item.metrics)).toBe(true);
  });

  test("each stratum holds on the asked day", () => {
    for (const item of core) {
      const asked = onDay(item);
      const measure = item.measure!;
      const agree = () =>
        withinTolerance(
          asked.map((metric) => metric.value),
          SOURCE_TOLERANCE[measure],
        );
      const sources = new Set(item.metrics.map((metric) => metric.source)).size;
      switch (item.stratum) {
        case "single_source":
          expect([asked.length, sources]).toEqual([1, 1]);
          break;
        case "agree":
          expect(asked.length).toBeGreaterThanOrEqual(2);
          expect(agree()).toBe(true);
          break;
        case "disagree":
          expect(asked.length).toBeGreaterThanOrEqual(2);
          expect(agree()).toBe(false);
          break;
        case "day_shift":
          expect([asked.length, sources]).toEqual([1, 2]);
          break;
        case "missing":
          expect(asked).toHaveLength(0);
          expect(item.metrics.length).toBeGreaterThan(0);
          break;
      }
    }
  });

  test("rules are balanced within each stratum", () => {
    for (const stratum of STRATA) {
      const items = core.filter((item) => item.stratum === stratum);
      const fixed = items.filter((item) => item.rule === "fixed_order").length;
      expect(fixed).toBe(Math.ceil(items.length / 2));
    }
  });

  test("the listing order does not follow the rule's order", () => {
    const multi = core.filter((item) => item.listing.length > 1);
    const ruleFirst = multi.filter(
      (item) => item.listing[0] === FIXED_ORDER.find((s) => item.listing.includes(s)),
    ).length;
    expect(ruleFirst / multi.length).toBeGreaterThan(0.3);
    expect(ruleFirst / multi.length).toBeLessThan(0.7);
  });

  test("expected answers by stratum and rule", () => {
    for (const item of core) {
      const kind = item.expected.kind;
      if (item.stratum === "missing") expect(kind).toBe("abstain");
      else if (item.stratum === "disagree" && item.rule === "hold_back")
        expect(kind).toBe("withhold");
      else expect(kind).toBe("state");
    }
  });

  test("probes ask about two different scores and expect them told apart", () => {
    const probes = w1.filter((item) => item.stratum === "construct_mismatch");
    for (const probe of probes) {
      expect(probe.measure).toBeNull();
      expect(probe.expected.kind).toBe("distinguish");
      expect(probe.metrics.map((metric) => metric.source).sort()).toEqual([
        "oura",
        "whoop",
      ]);
    }
  });

  test("every reading stays within a plausible night", () => {
    const range = {
      "resting-heart-rate": [35, 95],
      "heart-rate-variability": [8, 160],
    } as const;
    for (const item of core) {
      const [low, high] = range[item.measure as keyof typeof range];
      for (const metric of item.metrics) {
        expect(metric.value).toBeGreaterThanOrEqual(low);
        expect(metric.value).toBeLessThanOrEqual(high);
      }
    }
  });

  test("every reading is tagged with its source and day and is synthetic", () => {
    for (const item of w1) {
      expect(item.personId.startsWith(`test-${W1_DEFAULTS.seed}-w1-`)).toBe(true);
      for (const metric of item.metrics)
        expect(metric.key.endsWith(metric.date)).toBe(true);
    }
  });

  test("the development set is about a quarter, on its own seed and people", () => {
    const dev = generateW1(DEV_OPTIONS);
    expect(dev.filter((item) => item.stratum !== "construct_mismatch")).toHaveLength(60);
    const people = new Set(w1.map((item) => item.personId));
    expect(dev.some((item) => people.has(item.personId))).toBe(false);
  });
});

describe("expectedFor", () => {
  const day = "2026-01-02";
  const rhr = (source: "whoop" | "google_health", value: number): W1Metric => ({
    key: `${source === "whoop" ? "whoop.recovery.rhr" : "google.daily-resting-heart-rate"}.${day}`,
    label: "RHR",
    value,
    unit: "bpm",
    date: day,
    source,
  });

  test("fixed order states the first source in the order, naming the other", () => {
    expect(
      expectedFor(
        "fixed_order",
        FIXED_ORDER,
        [rhr("google_health", 60), rhr("whoop", 70)],
        "resting-heart-rate",
        day,
      ),
    ).toEqual({
      kind: "state",
      key: `whoop.recovery.rhr.${day}`,
      source: "whoop",
      day,
      others: ["google_health"],
    });
  });

  test("hold back withholds disagreeing readings and states agreeing ones", () => {
    expect(
      expectedFor(
        "hold_back",
        FIXED_ORDER,
        [rhr("whoop", 60), rhr("google_health", 70)],
        "resting-heart-rate",
        day,
      ).kind,
    ).toBe("withhold");
    expect(
      expectedFor(
        "hold_back",
        FIXED_ORDER,
        [rhr("whoop", 60), rhr("google_health", 62)],
        "resting-heart-rate",
        day,
      ).kind,
    ).toBe("state");
  });

  test("no reading on the asked day is an abstention", () => {
    expect(
      expectedFor(
        "fixed_order",
        FIXED_ORDER,
        [
          {
            ...rhr("whoop", 60),
            date: "2026-01-01",
            key: "whoop.recovery.rhr.2026-01-01",
          },
        ],
        "resting-heart-rate",
        day,
      ).kind,
    ).toBe("abstain");
  });
});

describe("dealStrata", () => {
  test("fills every quota exactly", () => {
    const hands = dealStrata(W1_QUOTAS, randomFor(1, "deal"));
    for (const stratum of STRATA) {
      expect(hands.flat().filter((s) => s === stratum)).toHaveLength(W1_QUOTAS[stratum]);
    }
  });
});
