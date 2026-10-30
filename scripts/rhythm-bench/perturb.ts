/**
 * Beat-detection errors added to a simulated recording, since rhythm-sim
 * makes clean beats (its motion artefact touches only the pulse wave), and
 * to the annotated beats of the database (`real-noise.ts`, #296). Pure and
 * seeded. Applied in this order: missed beats, spurious beats, jitter.
 *
 * - Missed beat: an inner beat is removed with probability `dropShare`; its
 *   two intervals merge and keep the label of the beat that ends the merged one.
 * - Spurious beat: a beat is inserted inside an interval with probability
 *   `spuriousShare`, at 20 to 80 % of it; both parts keep the interval's label.
 * - Jitter: every beat time moves by a normal draw with SD `jitterSdMs`,
 *   kept at least 1 ms after the beat before it, then rounded to whole ms.
 *
 * The levels used in the benchmark are assumptions, not measured error rates
 * of any device.
 */
import { type BeatLabel } from "@/packages/rhythm-sim/ectopic-beats";
import { normal, type Random } from "@/infrastructure/seeded-random";

export type Perturbation = Readonly<{
  dropShare: number;
  spuriousShare: number;
  jitterSdMs: number;
}>;

/** Beats with a label per interval: simulator beat labels, or a database's rhythm labels. */
export type LabelledBeats<L = BeatLabel> = Readonly<{
  /** Beat times, ms; one more than `labels`. */
  beatTimesMs: readonly number[];
  /** Label of the beat that ends each interval. */
  labels: readonly L[];
}>;

export const NO_PERTURBATION: Perturbation = {
  dropShare: 0,
  spuriousShare: 0,
  jitterSdMs: 0,
};

export const dropBeats = <L>(
  beats: LabelledBeats<L>,
  share: number,
  random: Random,
): LabelledBeats<L> => {
  const last = beats.beatTimesMs.length - 1;
  const keep = beats.beatTimesMs.map(
    (_, i) => i === 0 || i === last || random() >= share,
  );
  return {
    beatTimesMs: beats.beatTimesMs.filter((_, i) => keep[i]),
    // Interval i ends at beat i + 1; a kept beat ends the (possibly merged) interval.
    labels: beats.labels.filter((_, i) => keep[i + 1]),
  };
};

export const insertSpuriousBeats = <L>(
  beats: LabelledBeats<L>,
  share: number,
  random: Random,
): LabelledBeats<L> => {
  const pieces = beats.labels.map((label, i) => {
    const start = beats.beatTimesMs[i];
    const end = beats.beatTimesMs[i + 1];
    const insert = random() < share;
    const at = start + (0.2 + 0.6 * random()) * (end - start);
    return insert
      ? { times: [at, end], labels: [label, label] }
      : { times: [end], labels: [label] };
  });
  return {
    beatTimesMs: [beats.beatTimesMs[0], ...pieces.flatMap((piece) => piece.times)],
    labels: pieces.flatMap((piece) => piece.labels),
  };
};

export const jitterBeats = <L>(
  beats: LabelledBeats<L>,
  sdMs: number,
  random: Random,
): LabelledBeats<L> => {
  const moved = beats.beatTimesMs.map((time) => time + sdMs * normal(random));
  // A running maximum in one pass: database segments run to tens of thousands of beats.
  const ordered: number[] = [];
  for (const time of moved) {
    ordered.push(
      ordered.length === 0 ? time : Math.max(time, ordered[ordered.length - 1] + 1),
    );
  }
  return { beatTimesMs: ordered, labels: beats.labels };
};

/** Whole-ms intervals of beat times (times rounded first, so intervals add up). */
export const intervalsOf = (beatTimesMs: readonly number[]): number[] => {
  const rounded = beatTimesMs.map((time) => Math.round(time));
  return rounded.slice(1).map((time, i) => Math.max(1, time - rounded[i]));
};

/** Perturbed beats and how many beats were removed (missed) and inserted (spurious). */
export type CountedPerturbation<L> = Readonly<{
  beats: LabelledBeats<L>;
  missed: number;
  spurious: number;
}>;

export const perturbBeatsCounted = <L>(
  beats: LabelledBeats<L>,
  perturbation: Perturbation,
  random: Random,
): CountedPerturbation<L> => {
  const dropped =
    perturbation.dropShare > 0 ? dropBeats(beats, perturbation.dropShare, random) : beats;
  const spurious =
    perturbation.spuriousShare > 0
      ? insertSpuriousBeats(dropped, perturbation.spuriousShare, random)
      : dropped;
  return {
    beats:
      perturbation.jitterSdMs > 0
        ? jitterBeats(spurious, perturbation.jitterSdMs, random)
        : spurious,
    missed: beats.beatTimesMs.length - dropped.beatTimesMs.length,
    spurious: spurious.beatTimesMs.length - dropped.beatTimesMs.length,
  };
};

export const perturbBeats = <L>(
  beats: LabelledBeats<L>,
  perturbation: Perturbation,
  random: Random,
): LabelledBeats<L> => perturbBeatsCounted(beats, perturbation, random).beats;
