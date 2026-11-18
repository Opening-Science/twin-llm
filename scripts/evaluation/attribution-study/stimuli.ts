/**
 * The user study's stimuli (P6 Part B, section 6, #508): one synthetic
 * persona, "Alex", with nightly resting heart rate and HRV from Oura, WHOOP
 * and Google Health, and the answers participants judge. Pure and seeded.
 *
 * - Persona: 21 nights of resting heart rate (WHOOP, Google Health) and HRV
 *   (Oura, WHOOP, Google Health), seeded (`persona`). The data panel lists
 *   every reading in every arm.
 * - Detection trials (16): the answer states a number for the asked night;
 *   the chip claims a source and that night. `correct`: the number is that
 *   source's reading (8). `wrong_source`: it is another source's reading of
 *   that night (4). `wrong_day`: it is the claimed source's reading of the
 *   night before or after (4). Balanced over the two measures. All are
 *   constructed (the chip is set, not taken from a model answer), and
 *   labelled so; real model outputs can replace them later.
 * - Calibration trials (6): correct answers, three on a source and measure
 *   the accuracy review validated and three on one it found no evidence for.
 *   W1's measures have no "limited" pair, so the U2 gap is validated against
 *   none.
 * - Display per arm: D0 the answer alone; D1 the chip ("From WHOOP, 2 Jan
 *   2026") and, when other sources had a reading that night, the rule line;
 *   D2 D1 plus the accuracy note with its evidence level. The answer text is
 *   the same in every arm.
 *
 * A stated number is never shown as the same number as another reading a
 * participant checks it against (every source's that night, the claimed
 * source's on the nights next to it; `confusableCells`), so the check has
 * one answer. Synthetic only.
 */
import { formatDate, formatMetricValue } from "../../../infrastructure/format-measure";
import { normal, randomFor } from "../../../infrastructure/seeded-random";
import {
  cellsOf,
  confusableCells,
  type WearableCell,
} from "../../../infrastructure/wearable-cell";
import {
  pickedSourceLine,
  provenanceLine,
  type WearableSourceId,
} from "../../../infrastructure/wearable-provenance";
import {
  MEASURE_LABEL,
  type SourceMeasure,
} from "../../../infrastructure/wearable-source-rules";
import type { EvidenceLevel } from "../../../features/wearables/accuracy/types";
import {
  metricFor,
  SOURCE_DECIMALS,
  sourcesFor,
  usualUnit,
} from "../../synthetic-wearables/two-source";
import { ERROR_MODEL, FIXED_ORDER } from "../../synthetic-wearables/w1-items";
import { accuracyLine } from "./contexts";

export const STIMULI_VERSION = "twin-llm/attribution-stimuli/1";
export const DEFAULT_STIMULI_SEED = 6510;
export const PERSONA_NAME = "Alex";
const END_NIGHT = "2026-10-01";

export const ARMS = ["D0", "D1", "D2"] as const;
export type Arm = (typeof ARMS)[number];

export const STUDY_MEASURES: readonly SourceMeasure[] = [
  "resting-heart-rate",
  "heart-rate-variability",
];

export type Truth = "correct" | "wrong_source" | "wrong_day";

export type Display = Readonly<{
  chip: string | null;
  rule: string | null;
  note: string | null;
  level: EvidenceLevel | null;
}>;

export type Stimulus = Readonly<{
  id: string;
  kind: "detection" | "calibration";
  truth: Truth;
  origin: "constructed";
  measure: SourceMeasure;
  question: string;
  answer: string;
  /** What the chip claims. */
  claimed: Readonly<{ source: WearableSourceId; day: string }>;
  /** The reading the stated number is. */
  actual: Readonly<{ source: WearableSourceId; day: string; key: string }>;
  /** The review's evidence level for the claimed source and measure. */
  evidence: EvidenceLevel;
  display: Readonly<Record<Arm, Display>>;
}>;

export type PanelRow = Readonly<{
  source: WearableSourceId;
  day: string;
  measure: SourceMeasure;
  shown: string;
}>;

export type StimulusSet = Readonly<{
  version: string;
  testData: true;
  seed: number;
  /** Draws of the persona before one fitted every trial; 1 when the first did. */
  attempt: number;
  persona: Readonly<{ name: string; personId: string }>;
  panel: readonly PanelRow[];
  trials: readonly Stimulus[];
}>;

const shuffle = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other]!, out[index]!];
  }
  return out;
};

const addDays = (day: string, delta: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
};

/** A level and night-to-night spread per measure for the persona. */
const PERSONA_LEVEL: Readonly<
  Record<string, Readonly<{ level: number; spread: number }>>
> = {
  "resting-heart-rate": { level: 57, spread: 4 },
  "heart-rate-variability": { level: 48, spread: 9 },
};

/**
 * The persona's nightly readings of the study measures: a latent value per
 * night plus each source's assumed bias and noise (`ERROR_MODEL`, as W1),
 * rounded as the source stores it.
 */
export const persona = (
  seed: number,
  attempt = 1,
  nights = 21,
): Readonly<{ personId: string; cells: readonly WearableCell[] }> => {
  const random = randomFor(seed, `persona|${attempt}`);
  const personId = `test-${seed}-persona`;
  const metrics = STUDY_MEASURES.flatMap((measure) => {
    const { level, spread } = PERSONA_LEVEL[measure]!;
    return Array.from({ length: nights }, (_, index) =>
      addDays(END_NIGHT, -index),
    ).flatMap((day) => {
      const latent = level + spread * normal(random);
      // Google Health records every night; the others miss about one
      // night in three, so some nights have Google Health alone and its reading is
      // the one shown.
      const worn = sourcesFor(measure).filter(
        (source) =>
          source !== "bodyloop" && (source === "google_health" || random() >= 0.35),
      );
      return worn.map((source) => {
        const error = ERROR_MODEL[measure][source] ?? { bias: 0, sd: 0 };
        const raw = latent + error.bias + error.sd * normal(random);
        const value =
          SOURCE_DECIMALS[source][measure] === 1
            ? Math.round(raw * 10) / 10
            : Math.round(raw);
        const unit = usualUnit(source, measure);
        return {
          ...metricFor({ source, value, unit }, measure, day),
          source,
        };
      });
    });
  });
  return { personId, cells: cellsOf(metrics) };
};

const cellAt = (
  cells: readonly WearableCell[],
  measure: string,
  source: WearableSourceId,
  day: string,
): WearableCell | undefined =>
  cells.find(
    (cell) => cell.measure === measure && cell.source === source && cell.day === day,
  );

const displayFor = (
  claimed: Readonly<{ source: WearableSourceId; day: string }>,
  measure: SourceMeasure,
  others: readonly WearableSourceId[],
): Readonly<Record<Arm, Display>> => {
  const chip = provenanceLine({ source: claimed.source, day: claimed.day });
  const rule = pickedSourceLine(claimed.source, others);
  const note = accuracyLine(claimed.source, measure);
  return {
    D0: { chip: null, rule: null, note: null, level: null },
    D1: { chip, rule, note: null, level: null },
    D2: { chip, rule, note: note?.text ?? null, level: note?.level ?? null },
  };
};

type Candidate = Readonly<{
  measure: SourceMeasure;
  day: string;
  claimed: WearableSourceId;
  actual: WearableCell;
  truth: Truth;
}>;

/**
 * Every detection trial the persona's readings allow. The chip always claims
 * the source the fixed order shows that night, as the app's chip does, so
 * its rule line is true; only the stated number differs.
 */
const candidates = (cells: readonly WearableCell[]): readonly Candidate[] => {
  return cells.flatMap((cell): Candidate[] => {
    const measure = cell.measure as SourceMeasure;
    const day = cell.day!;
    const shown = FIXED_ORDER.find((source) => cellAt(cells, measure, source, day));
    if (shown !== cell.source) return [];
    const sameNight = cells.filter(
      (other) => other.measure === measure && other.day === day && other.key !== cell.key,
    );
    const nextDays = [addDays(day, -1), addDays(day, 1)].flatMap((other) => {
      const found = cellAt(cells, measure, cell.source, other);
      return found === undefined ? [] : [found];
    });
    const all: Candidate[] = [
      { measure, day, claimed: cell.source, actual: cell, truth: "correct" as const },
      ...sameNight.map((other) => ({
        measure,
        day,
        claimed: cell.source,
        actual: other,
        truth: "wrong_source" as const,
      })),
      ...nextDays.map((other) => ({
        measure,
        day,
        claimed: cell.source,
        actual: other,
        truth: "wrong_day" as const,
      })),
    ];
    // The readings a participant checks the number against: every source's
    // that night, and the claimed source's on the nights next to it.
    const checked = cells.filter(
      (other) =>
        other.measure === measure &&
        (other.day === day || (other.source === cell.source && nextDays.includes(other))),
    );
    return all.filter((candidate) =>
      checked.every(
        (other) =>
          other.key === candidate.actual.key ||
          confusableCells([other, candidate.actual]).length === 0,
      ),
    );
  });
};

const stimulusOf = (
  candidate: Candidate,
  kind: Stimulus["kind"],
  index: number,
  cells: readonly WearableCell[],
): Stimulus => {
  const { measure, day, claimed, actual, truth } = candidate;
  const others = cells
    .filter(
      (cell) => cell.measure === measure && cell.day === day && cell.source !== claimed,
    )
    .map((cell) => cell.source);
  const note = accuracyLine(claimed, measure);
  return {
    id: `${kind}-${String(index + 1).padStart(2, "0")}`,
    kind,
    truth,
    origin: "constructed",
    measure,
    question: `What was my ${MEASURE_LABEL[measure]} on the night of ${formatDate(day)}?`,
    answer: `Your ${MEASURE_LABEL[measure]} on the night of ${formatDate(day)} was ${formatMetricValue(actual)}.`,
    claimed: { source: claimed, day },
    actual: { source: actual.source, day: actual.day!, key: actual.key },
    evidence: note?.level ?? "none",
    display: displayFor({ source: claimed, day }, measure, others),
  };
};

/** Picks `count` candidates, alternating the measures, without reusing a night and measure. */
const pickBalanced = (
  pool: readonly Candidate[],
  count: number,
  used: Set<string>,
  random: () => number,
): readonly Candidate[] | null => {
  const out: Candidate[] = [];
  const shuffled = shuffle(pool, random);
  for (let round = 0; out.length < count && round < count * 2; round += 1) {
    const measure = STUDY_MEASURES[out.length % STUDY_MEASURES.length]!;
    const next = shuffled.find(
      (candidate) =>
        candidate.measure === measure &&
        !used.has(`${candidate.measure}|${candidate.day}`),
    );
    if (next === undefined) continue;
    used.add(`${next.measure}|${next.day}`);
    out.push(next);
  }
  return out.length < count ? null : out;
};

export const TRIAL_COUNTS = { correct: 8, wrong_source: 4, wrong_day: 4 } as const;

export const MAX_STIMULI_ATTEMPTS = 50;

/**
 * The stimulus set of a seed: the first persona, drawn again at most
 * `MAX_STIMULI_ATTEMPTS` times, whose readings fit every trial.
 */
export const generateStimuli = (seed: number = DEFAULT_STIMULI_SEED): StimulusSet => {
  for (let attempt = 1; attempt <= MAX_STIMULI_ATTEMPTS; attempt += 1) {
    const set = stimuliFor(seed, attempt);
    if (set !== null) return set;
  }
  throw new Error(`No persona of seed ${seed} fits the trials`);
};

const stimuliFor = (seed: number, attempt: number): StimulusSet | null => {
  const { personId, cells } = persona(seed, attempt);
  const all = candidates(cells);
  const random = randomFor(seed, `stimuli|${attempt}`);
  const used = new Set<string>();
  const of = (truth: Truth) => all.filter((candidate) => candidate.truth === truth);
  // Calibration first: nights with Google Health alone are few, and the
  // evidence-level contrast needs three of them.
  const byLevel = (level: EvidenceLevel) =>
    of("correct").filter(
      (candidate) => accuracyLine(candidate.claimed, candidate.measure)?.level === level,
    );
  const calibrationPicks = [
    ...shuffle(byLevel("validated"), random).slice(0, 3),
    ...shuffle(byLevel("none"), random).slice(0, 3),
  ];
  if (calibrationPicks.length < 6) return null;
  for (const pick of calibrationPicks) used.add(`${pick.measure}|${pick.day}`);
  const calibration = calibrationPicks.map((candidate, index) =>
    stimulusOf(candidate, "calibration", index, cells),
  );
  const wrongSource = pickBalanced(
    of("wrong_source"),
    TRIAL_COUNTS.wrong_source,
    used,
    random,
  );
  const wrongDay = pickBalanced(of("wrong_day"), TRIAL_COUNTS.wrong_day, used, random);
  const correct = pickBalanced(of("correct"), TRIAL_COUNTS.correct, used, random);
  if (wrongSource === null || wrongDay === null || correct === null) return null;
  const detection = shuffle([...wrongSource, ...wrongDay, ...correct], random).map(
    (candidate, index) => stimulusOf(candidate, "detection", index, cells),
  );
  return {
    version: STIMULI_VERSION,
    testData: true,
    seed,
    attempt,
    persona: { name: PERSONA_NAME, personId },
    panel: cells
      .map((cell) => ({
        source: cell.source,
        day: cell.day!,
        measure: cell.measure as SourceMeasure,
        shown: formatMetricValue(cell),
      }))
      .sort(
        (a, b) =>
          b.day.localeCompare(a.day) ||
          a.measure.localeCompare(b.measure) ||
          a.source.localeCompare(b.source),
      ),
    trials: [...detection, ...calibration],
  };
};
