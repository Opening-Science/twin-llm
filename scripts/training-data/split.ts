/**
 * A train/validation split that measures generalisation, not template recall.
 * Validation gets every conversation that uses a held-out template group
 * (`slot.style`, all its templates), asks about a held-out LOINC code, or is
 * about a held-out subject. Pure and seeded: the same metas, options and seed
 * give the same split.
 *
 * Holding out never empties a family or a question slot in training: a group
 * or code is skipped when it is the last one some family or slot still has.
 */
import { hash32 } from "../synthetic-wearables/random";

export type SplitMeta = Readonly<{
  family: string;
  template_group: string;
  measure_loinc: string | null;
  subject_ref: string | null;
}>;

export type SplitOptions = Readonly<{
  seed: number;
  /** Share of template groups held out (0–1). */
  templateShare: number;
  /** Share of asked LOINC codes held out (0–1). */
  codeShare: number;
  /** Share of subjects held out (0–1). */
  subjectShare: number;
}>;

export type SplitPlan = Readonly<{
  templateGroups: readonly string[];
  loinc: readonly string[];
}>;

export type HoldoutReason = "template" | "code" | "subject";

const slotOf = (group: string): string => group.split(".")[0] ?? group;

const order = (seed: number, kind: string, values: Iterable<string>): string[] =>
  [...new Set(values)].sort(
    (a, b) =>
      hash32(`${seed}:${kind}:${a}`) - hash32(`${seed}:${kind}:${b}`) ||
      a.localeCompare(b),
  );

type Combo = Readonly<{
  family: string;
  slot: string;
  group: string;
  loinc: string | null;
}>;

/** True when every family and every slot keeps at least one combination in training. */
const covered = (
  combos: readonly Combo[],
  groups: ReadonlySet<string>,
  codes: ReadonlySet<string>,
): boolean => {
  const kept = combos.filter(
    (combo) =>
      !groups.has(combo.group) && !(combo.loinc !== null && codes.has(combo.loinc)),
  );
  const keptFamilies = new Set(kept.map((combo) => combo.family));
  const keptSlots = new Set(kept.map((combo) => combo.slot));
  return combos.every(
    (combo) => keptFamilies.has(combo.family) && keptSlots.has(combo.slot),
  );
};

/**
 * Template groups first, then codes, each in seeded order. A candidate is
 * skipped when holding it out (with everything already held) would leave some
 * family or slot with nothing in training.
 */
export const planSplit = (
  metas: readonly SplitMeta[],
  options: SplitOptions,
): SplitPlan => {
  const combos: Combo[] = [
    ...new Map(
      metas.map((meta) => {
        const combo = {
          family: meta.family,
          slot: slotOf(meta.template_group),
          group: meta.template_group,
          loinc: meta.measure_loinc,
        };
        return [JSON.stringify(combo), combo] as const;
      }),
    ).values(),
  ];
  const groups = order(
    options.seed,
    "group",
    combos.map((combo) => combo.group),
  );
  const codes = order(
    options.seed,
    "loinc",
    combos.flatMap((combo) => (combo.loinc === null ? [] : [combo.loinc])),
  );
  const pick = (
    candidates: readonly string[],
    target: number,
    test: (held: ReadonlySet<string>) => boolean,
  ): string[] =>
    candidates.reduce<string[]>((held, key) => {
      if (held.length >= target) return held;
      return test(new Set([...held, key])) ? [...held, key] : held;
    }, []);
  const templateGroups = pick(
    groups,
    Math.round(options.templateShare * groups.length),
    (held) => covered(combos, held, new Set()),
  );
  const heldGroups = new Set(templateGroups);
  const loinc = pick(codes, Math.round(options.codeShare * codes.length), (held) =>
    covered(combos, heldGroups, held),
  );
  return { templateGroups: templateGroups.sort(), loinc: loinc.sort() };
};

const UNIT = 2 ** 32;

export const subjectHeldOut = (
  subjectRef: string | null,
  options: SplitOptions,
): boolean =>
  subjectRef !== null &&
  hash32(`${options.seed}:subject:${subjectRef}`) / UNIT < options.subjectShare;

/** Why a conversation goes to validation; empty means training. */
export const holdoutReasons = (
  meta: SplitMeta,
  plan: SplitPlan,
  options: SplitOptions,
): HoldoutReason[] => [
  ...(plan.templateGroups.includes(meta.template_group) ? (["template"] as const) : []),
  ...(meta.measure_loinc !== null && plan.loinc.includes(meta.measure_loinc)
    ? (["code"] as const)
    : []),
  ...(subjectHeldOut(meta.subject_ref, options) ? (["subject"] as const) : []),
];
