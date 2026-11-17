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

  test("the rule swap reverses the order or turns hold back into fixed order", () => {
    for (const item of items) {
      const swap = counterfactuals(item).find(
        (variant) => variant.variant === "rule_swap",
      );
      if (swap === undefined) continue;
      expect(swap.item.rule).toBe("fixed_order");
      expect(swap.item.expected.kind).toBe("state");
      if (item.rule === "fixed_order") expect(swap.order).toEqual(SWAPPED_ORDER);
    }
  });

  test("swapping Oura and WHOOP changes the expected source where both read the day", () => {
    const both = items.filter(
      (item) =>
        item.rule === "fixed_order" &&
        item.stratum === "agree" &&
        asked(item).some((metric) => metric.source === "oura") &&
        asked(item).some((metric) => metric.source === "whoop"),
    );
    expect(both.length).toBeGreaterThan(0);
    for (const item of both) {
      const swap = counterfactuals(item).find(
        (variant) => variant.variant === "rule_swap",
      );
      expect(item.expected.kind === "state" && item.expected.source).toBe("oura");
      expect(swap?.item.expected.kind === "state" && swap.item.expected.source).toBe(
        "whoop",
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
