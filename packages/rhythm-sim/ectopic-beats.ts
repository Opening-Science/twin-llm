/**
 * Premature beats placed into sinus rhythm. A premature atrial beat (PAC)
 * comes early and resets the sinus node, so the next interval is an ordinary
 * sinus interval and the pause is less than compensatory. A premature
 * ventricular beat (PVC) leaves the sinus node alone, so the beat after it
 * keeps its place: coupling interval plus pause equals two sinus intervals (a
 * full compensatory pause). Pure.
 */
import { type Random } from "@/infrastructure/seeded-random";

export type BeatLabel = "sinus" | "af" | "pac" | "pvc";

export type EctopyPlan = Readonly<{
  pacCount: number;
  pvcCount: number;
  pacPrematurity: number;
  pvcPrematurity: number;
}>;

export type Intervals = Readonly<{
  rrMs: readonly number[];
  labels: readonly BeatLabel[];
}>;

/** Ectopic beats sit at least this many intervals apart. */
export const ECTOPIC_SPACING = 3;

/** Fisher–Yates on a copy, in seeded random order. */
export const shuffled = <T>(items: readonly T[], random: Random): T[] => {
  const copy = [...items];
  for (let index = 0; index < copy.length - 1; index += 1) {
    const swap = index + Math.floor(random() * (copy.length - index));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
};

/**
 * Interval indices where an ectopic beat may go: the interval and the one after
 * it are sinus, and neither is the first or the last of the recording.
 */
export const ectopicCandidates = (labels: readonly BeatLabel[]): number[] =>
  labels
    .map((_, index) => index)
    .filter(
      (index) =>
        index >= 1 &&
        index <= labels.length - 3 &&
        labels[index] === "sinus" &&
        labels[index + 1] === "sinus",
    );

/**
 * Picks `count` candidates in seeded random order, keeping ECTOPIC_SPACING
 * between them. Throws when the recording has too few sinus beats for them.
 */
export const pickEctopicSites = (
  labels: readonly BeatLabel[],
  count: number,
  random: Random,
): number[] => {
  const sites = shuffled(ectopicCandidates(labels), random).reduce<number[]>(
    (chosen, index) =>
      chosen.length < count &&
      chosen.every((other) => Math.abs(other - index) >= ECTOPIC_SPACING)
        ? [...chosen, index]
        : chosen,
    [],
  );
  if (sites.length < count) {
    throw new Error(
      `only ${sites.length} places for ${count} ectopic beats; lengthen the recording or ask for fewer`,
    );
  }
  return sites;
};

/** The intervals with the planned PACs and PVCs put in; RR values stay whole ms. */
export const insertEctopicBeats = (
  intervals: Intervals,
  plan: EctopyPlan,
  random: Random,
): Intervals => {
  const total = plan.pacCount + plan.pvcCount;
  if (total === 0) return intervals;
  const sites = pickEctopicSites(intervals.labels, total, random);
  const kindAt = new Map<number, "pac" | "pvc">(
    sites.map((site, order) => [site, order < plan.pacCount ? "pac" : "pvc"]),
  );
  const rrMs = intervals.rrMs.map((rr, index) => {
    const kind = kindAt.get(index);
    if (kind !== undefined) {
      const prematurity = kind === "pac" ? plan.pacPrematurity : plan.pvcPrematurity;
      return Math.round((1 - prematurity) * rr);
    }
    const before = kindAt.get(index - 1);
    if (before === "pvc") {
      const coupled = intervals.rrMs[index - 1];
      return rr + coupled - Math.round((1 - plan.pvcPrematurity) * coupled);
    }
    return rr;
  });
  const labels = intervals.labels.map((label, index) => kindAt.get(index) ?? label);
  return { rrMs, labels };
};
