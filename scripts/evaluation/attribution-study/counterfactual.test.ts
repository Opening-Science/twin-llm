import { describe, expect, test } from "bun:test";

import {
  SOURCE_TOLERANCE,
  withinTolerance,
} from "../../../infrastructure/wearable-source-rules";
import {
  DEV_OPTIONS,
  generateW1,
  isIdentifiable,
  type W1Item,
} from "../../synthetic-wearables/w1-items";

import { counterfactuals, studyItems, SWAPPED_ORDER } from "./counterfactual";

const items = generateW1(DEV_OPTIONS);
const asked = (item: W1Item) =>
  item.metrics.filter((metric) => metric.date === item.askedDay);
const agrees = (item: W1Item) =>
  withinTolerance(
    asked(item).map((metric) => metric.value),
    SOURCE_TOLERANCE[item.measure!],
  );

describe("counterfactuals", () => {
  test("only agree and disagree items get variants", () => {
    for (const item of items) {
      const variants = counterfactuals(item);
      if (item.stratum === "agree" || item.stratum === "disagree") {
        expect(variants.length).toBeGreaterThan(0);
      } else {
        expect(variants).toEqual([]);
      }
    }
  });

  test("a perturbed item keeps its stratum and identifiability, and moves one reading", () => {
    for (const item of items) {
      for (const variant of counterfactuals(item)) {
        if (variant.variant === "rule_swap") continue;
        expect(isIdentifiable(variant.item.metrics)).toBe(true);
        expect(agrees(variant.item)).toBe(agrees(item));
        const changed = variant.item.metrics.filter(
          (metric, index) => metric.value !== item.metrics[index]?.value,
        );
        expect(changed).toHaveLength(1);
      }
    }
  });

  test("perturb_cited moves the expected reading; perturb_other another", () => {
    for (const item of items) {
      for (const variant of counterfactuals(item)) {
        if (variant.variant === "rule_swap" || item.expected.kind !== "state") continue;
        const changed = variant.item.metrics.find(
          (metric, index) => metric.value !== item.metrics[index]?.value,
        );
        if (variant.variant === "perturb_cited") {
          expect(changed?.key).toBe(item.expected.key);
        } else {
          expect(changed?.key).not.toBe(item.expected.key);
        }
      }
    }
  });

  test("the rule swap is fixed order, reversed", () => {
    expect(SWAPPED_ORDER).toEqual(["google_health", "whoop", "oura"]);
    for (const item of items) {
      const swap = counterfactuals(item).find(
        (variant) => variant.variant === "rule_swap",
      );
      if (swap === undefined) continue;
      expect(swap.item.rule).toBe("fixed_order");
      expect(swap.item.expected.kind).toBe("state");
      expect(swap.order).toEqual(SWAPPED_ORDER);
    }
  });

  test("every agree and disagree item gets a swap that changes the answer asked for", () => {
    for (const item of items) {
      if (item.stratum !== "agree" && item.stratum !== "disagree") continue;
      const swap = counterfactuals(item).find(
        (variant) => variant.variant === "rule_swap",
      );
      expect(swap).toBeDefined();
      expect(swap?.item.expected).not.toEqual(item.expected);
    }
  });

  test("a resting heart rate item, which Oura never reads, still changes source", () => {
    const rhr = items.filter(
      (item) =>
        item.rule === "fixed_order" &&
        item.measure === "resting-heart-rate" &&
        (item.stratum === "agree" || item.stratum === "disagree"),
    );
    expect(rhr.length).toBeGreaterThan(0);
    for (const item of rhr) {
      const swap = counterfactuals(item).find(
        (variant) => variant.variant === "rule_swap",
      );
      expect(item.expected.kind === "state" && item.expected.source).toBe("whoop");
      expect(swap?.item.expected.kind === "state" && swap.item.expected.source).toBe(
        "google_health",
      );
    }
  });
});

describe("studyItems", () => {
  test("every item once as it is, variants only when asked for", () => {
    expect(studyItems(items, false)).toHaveLength(items.length);
    const all = studyItems(items, true);
    expect(all.filter((study) => study.variant === "base")).toHaveLength(items.length);
    expect(all.length).toBeGreaterThan(items.length);
  });
});
