/**
 * Counterfactual reruns of the source-attribution study (P6 section 5,
 * RQ2, #508): the same item with one thing changed, to test whether a
 * citation that is right by value is also right causally. Pure.
 *
 * - `perturb_cited`: the reading a right answer states moves by a small step;
 *   a faithful answer's number follows it.
 * - `perturb_other`: another source's asked-day reading moves; a faithful
 *   answer's number stays.
 * - `rule_swap`: under `fixed_order` the order's first two sources swap
 *   (WHOOP, Oura, Google Health); under `hold_back` the rule becomes
 *   `fixed_order`, so a value held back must now be stated. A faithful
 *   answer's source follows the new rule.
 *
 * A step keeps the item's stratum (agreeing readings still agree, disagreeing
 * ones still disagree) and its identifiability; steps of 1, then 2, display
 * units are tried in both directions, and a variant no step fits is skipped.
 * Only agree and disagree items get variants.
 */
import type { WearableSourceId } from "../../../infrastructure/wearable-provenance";
import {
  SOURCE_TOLERANCE,
  withinTolerance,
} from "../../../infrastructure/wearable-source-rules";
import {
  expectedFor,
  FIXED_ORDER,
  isIdentifiable,
  type W1Item,
  type W1Metric,
} from "../../synthetic-wearables/w1-items";

export const VARIANTS = ["base", "perturb_cited", "perturb_other", "rule_swap"] as const;
export type Variant = (typeof VARIANTS)[number];

export type StudyItem = Readonly<{
  item: W1Item;
  variant: Variant;
  /** The fixed order the rule names for this run. */
  order: readonly WearableSourceId[];
}>;

/** WHOOP before Oura: the order the rule-swap rerun names. */
export const SWAPPED_ORDER: readonly WearableSourceId[] = [
  "whoop",
  "oura",
  "google_health",
];

const STEPS = [1, -1, 2, -2] as const;

const agrees = (item: W1Item, metrics: readonly W1Metric[]): boolean =>
  item.measure !== null &&
  withinTolerance(
    metrics
      .filter((metric) => metric.date === item.askedDay)
      .map((metric) => metric.value),
    SOURCE_TOLERANCE[item.measure],
  );

const moved = (
  item: W1Item,
  key: string,
  variant: "perturb_cited" | "perturb_other",
): StudyItem | null => {
  if (item.measure === null) return null;
  const before = agrees(item, item.metrics);
  for (const step of STEPS) {
    const metrics = item.metrics.map((metric) =>
      metric.key === key
        ? { ...metric, value: Math.round((metric.value + step) * 10) / 10 }
        : metric,
    );
    if (agrees(item, metrics) !== before || !isIdentifiable(metrics)) continue;
    const changed: W1Item = {
      ...item,
      id: `${item.id}-${variant}`,
      metrics,
      expected: expectedFor(item.rule, FIXED_ORDER, metrics, item.measure, item.askedDay),
    };
    return { item: changed, variant, order: FIXED_ORDER };
  }
  return null;
};

const ruleSwap = (item: W1Item): StudyItem | null => {
  if (item.measure === null) return null;
  const rule = "fixed_order" as const;
  const order = item.rule === "fixed_order" ? SWAPPED_ORDER : FIXED_ORDER;
  return {
    item: {
      ...item,
      id: `${item.id}-rule_swap`,
      rule,
      expected: expectedFor(rule, order, item.metrics, item.measure, item.askedDay),
    },
    variant: "rule_swap",
    order,
  };
};

/** The variants of one item; empty outside the agree and disagree strata. */
export const counterfactuals = (item: W1Item): readonly StudyItem[] => {
  if (item.stratum !== "agree" && item.stratum !== "disagree") return [];
  const asked = item.metrics.filter((metric) => metric.date === item.askedDay);
  const expected = item.expected;
  const citedKey = expected.kind === "state" ? expected.key : null;
  const other = asked.find((metric) => metric.key !== citedKey);
  return [
    ...(citedKey === null ? [] : [moved(item, citedKey, "perturb_cited")]),
    ...(other === undefined ? [] : [moved(item, other.key, "perturb_other")]),
    ruleSwap(item),
  ].filter((variant): variant is StudyItem => variant !== null);
};

/** Every run of a study: each item as it is, and the variants when asked for. */
export const studyItems = (
  items: readonly W1Item[],
  withCounterfactuals: boolean,
): readonly StudyItem[] =>
  items.flatMap((item) => [
    { item, variant: "base" as const, order: FIXED_ORDER },
    ...(withCounterfactuals ? counterfactuals(item) : []),
  ]);
