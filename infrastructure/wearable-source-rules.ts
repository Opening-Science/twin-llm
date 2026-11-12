/**
 * Which wearable reading the app uses when more than one source recorded the
 * same measure on the same day, and why (#464). The rule set is in
 * docs/wearable-sources.md; its version goes into every audit row, so a
 * study of the answers (#508) can tell which rules produced them.
 *
 * Pure and evidence-free: the published validation grades come in through an
 * `EvidenceJudge`, which the server builds from open-twin's reliability table
 * (`judgeByEvidence` in `open-twin-adapters/aggregate.ts`). That table needs Node, so the
 * decisions are made on the server and the browser only shows them.
 *
 * Readings are compared only when they measure the same thing (the table
 * below); a related measure from another source is not a disagreement.
 */
import {
  formatMetricValue,
  isMainSleepKey,
  metricStem,
  type FormattableMetric,
} from "./format-measure";
import {
  metricDay,
  sourceOfMetricKey,
  WEARABLE_SOURCE_IDS,
  WEARABLE_SOURCE_LABEL,
  type WearableSourceId,
} from "./wearable-provenance";

export const SOURCE_RULES_VERSION = "wearable-source-rules/1";

/** The measures compared across sources, named as open-twin's reliability table names them. */
export const SOURCE_MEASURES = [
  "heart-rate-variability",
  "resting-heart-rate",
  "oxygen-saturation",
  "step-count",
] as const;

export type SourceMeasure = (typeof SOURCE_MEASURES)[number];

export type EvidenceGrade = "good" | "fair" | "poor" | "unknown";

/**
 * Readings agree when the largest and smallest differ by no more than
 * `absolute`, or by no more than `relative` of the largest. TwinLLM's own
 * display tolerances, not published agreement limits.
 */
export type Tolerance = Readonly<{ absolute: number; relative: number; unit: string }>;

export const SOURCE_TOLERANCE: Readonly<Record<SourceMeasure, Tolerance>> = {
  "heart-rate-variability": { absolute: 5, relative: 0.1, unit: "ms" },
  "resting-heart-rate": { absolute: 3, relative: 0, unit: "bpm" },
  "oxygen-saturation": { absolute: 1, relative: 0, unit: "%" },
  "step-count": { absolute: 200, relative: 0.05, unit: "steps" },
};

/** Units a reading may carry; a stored reading without one is taken to be in the first. */
export const SOURCE_UNITS: Readonly<Record<SourceMeasure, readonly string[]>> = {
  "heart-rate-variability": ["ms"],
  "resting-heart-rate": ["bpm", "/min", "beats/min", "{beats}/min"],
  "oxygen-saturation": ["%"],
  "step-count": ["steps", "{steps}", "/d", "{steps}/d", "1"],
};

/**
 * Stored stems that measure the same thing. Oura's overnight HRV and WHOOP's
 * recovery HRV are both RMSSD in ms over the night and are compared; Oura's
 * sleeping heart rate and WHOOP's day average are different measures and are not.
 */
export const COMPARABLE_STEMS: Readonly<Record<string, SourceMeasure>> = {
  "sleep.hrv": "heart-rate-variability",
  "whoop.recovery.hrv": "heart-rate-variability",
  "google.daily-heart-rate-variability": "heart-rate-variability",
  "whoop.recovery.rhr": "resting-heart-rate",
  "google.daily-resting-heart-rate": "resting-heart-rate",
  "whoop.recovery.spo2": "oxygen-saturation",
  "google.daily-oxygen-saturation": "oxygen-saturation",
  "activity.steps": "step-count",
  "google.steps": "step-count",
};

export const MEASURE_LABEL: Readonly<Record<SourceMeasure, string>> = {
  "heart-rate-variability": "HRV",
  "resting-heart-rate": "resting heart rate",
  "oxygen-saturation": "blood oxygen",
  "step-count": "steps",
};

export type SourceReading = Readonly<{
  key: string;
  source: WearableSourceId;
  value: number;
  unit: string | null;
  /** The value as the app prints it, with its unit. */
  shown: string;
}>;

/** Why no reading is used. The first three come from the evidence, the last two from the readings. */
export const HOLD_REASONS = [
  "no_evidence",
  "evidence_tie",
  "no_dependable_source",
  "units_differ",
  "no_day",
] as const;

export type HoldReason = (typeof HOLD_REASONS)[number];

export type EvidenceVerdict =
  | Readonly<{
      kind: "selected";
      winner: WearableSourceId;
      grades: Readonly<Partial<Record<WearableSourceId, EvidenceGrade>>>;
      citation: string;
    }>
  | Readonly<{
      kind: "abstained";
      reason: "no_evidence" | "evidence_tie" | "no_dependable_source";
      grades: Readonly<Partial<Record<WearableSourceId, EvidenceGrade>>>;
    }>;

/** Published validation for these sources on this measure; never decided on their order. */
export type EvidenceJudge = (
  sources: readonly WearableSourceId[],
  measure: SourceMeasure,
) => EvidenceVerdict;

type Occasion = Readonly<{ measure: SourceMeasure; day: string | null }>;

/**
 * One decision per measure and day. `only_source`: nothing to compare.
 * `agree`: every source is within the tolerance. `evidence`: they disagree
 * and published validation prefers one. `held_back`: they disagree (or
 * cannot be compared) and nothing says which is right, so none is used.
 */
export type SourceDecision = Occasion &
  (
    | Readonly<{ kind: "only_source"; chosen: SourceReading }>
    | Readonly<{ kind: "agree"; chosen: SourceReading; others: readonly SourceReading[] }>
    | Readonly<{
        kind: "evidence";
        chosen: SourceReading;
        others: readonly SourceReading[];
        grades: Readonly<Partial<Record<WearableSourceId, EvidenceGrade>>>;
        citation: string;
      }>
    | Readonly<{
        kind: "held_back";
        readings: readonly SourceReading[];
        reason: HoldReason;
      }>
  );

export type SourceDecisionKind = SourceDecision["kind"];

const SOURCE_ORDER: readonly WearableSourceId[] = WEARABLE_SOURCE_IDS;

const bySourceOrder = (a: SourceReading, b: SourceReading): number =>
  SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
  a.key.localeCompare(b.key);

const readingOf = (
  metric: FormattableMetric & Readonly<{ source?: WearableSourceId }>,
): (SourceReading & Occasion) | null => {
  // WHOOP writes "unknown" where the day goes (`day-key.ts`).
  const measure = COMPARABLE_STEMS[metricStem(metric.key).replace(/\.unknown$/, "")];
  if (measure === undefined || !isMainSleepKey(metric.key)) return null;
  const value = typeof metric.value === "number" ? metric.value : Number.NaN;
  if (!Number.isFinite(value)) return null;
  return {
    key: metric.key,
    source: metric.source ?? sourceOfMetricKey(metric.key),
    value,
    unit: metric.unit ?? null,
    shown: formatMetricValue(metric),
    measure,
    day: metricDay(metric),
  };
};

const unitFits = (reading: SourceReading, measure: SourceMeasure): boolean =>
  reading.unit === null || SOURCE_UNITS[measure].includes(reading.unit.toLowerCase());

export const withinTolerance = (
  values: readonly number[],
  tolerance: Tolerance,
): boolean => {
  const high = Math.max(...values);
  const spread = high - Math.min(...values);
  return spread <= Math.max(tolerance.absolute, tolerance.relative * Math.abs(high));
};

/** The decision for one measure on one day, from one reading per source. */
export const decideOccasion = (
  occasion: Occasion,
  readings: readonly SourceReading[],
  judge: EvidenceJudge,
): SourceDecision => {
  const sorted = [...readings].sort(bySourceOrder);
  const [first, ...rest] = sorted;
  if (first === undefined) throw new Error("decideOccasion needs a reading");
  if (rest.length === 0) return { ...occasion, kind: "only_source", chosen: first };
  if (occasion.day === null) {
    return { ...occasion, kind: "held_back", readings: sorted, reason: "no_day" };
  }
  if (!sorted.every((reading) => unitFits(reading, occasion.measure))) {
    return { ...occasion, kind: "held_back", readings: sorted, reason: "units_differ" };
  }
  if (
    withinTolerance(
      sorted.map((reading) => reading.value),
      SOURCE_TOLERANCE[occasion.measure],
    )
  ) {
    // Agreeing readings say the same thing; the order only picks which one is printed.
    return { ...occasion, kind: "agree", chosen: first, others: rest };
  }
  const verdict = judge(
    sorted.map((reading) => reading.source),
    occasion.measure,
  );
  if (verdict.kind === "abstained") {
    return { ...occasion, kind: "held_back", readings: sorted, reason: verdict.reason };
  }
  const chosen = sorted.find((reading) => reading.source === verdict.winner);
  if (chosen === undefined) {
    return { ...occasion, kind: "held_back", readings: sorted, reason: "no_evidence" };
  }
  return {
    ...occasion,
    kind: "evidence",
    chosen,
    others: sorted.filter((reading) => reading !== chosen),
    grades: verdict.grades,
    citation: verdict.citation,
  };
};

/**
 * Every comparable measure and day across the metrics given, newest day
 * first. Of one source's readings on a day the first by key is taken, so the
 * API's order never matters; Oura's naps and rests are left out.
 */
export const decideSources = (
  metrics: readonly (FormattableMetric & Readonly<{ source?: WearableSourceId }>)[],
  judge: EvidenceJudge,
): readonly SourceDecision[] => {
  const groups = new Map<string, Map<WearableSourceId, SourceReading & Occasion>>();
  for (const metric of metrics) {
    const reading = readingOf(metric);
    if (reading === null) continue;
    const id = `${reading.measure}|${reading.day ?? ""}`;
    const group = groups.get(id) ?? new Map<WearableSourceId, SourceReading & Occasion>();
    const held = group.get(reading.source);
    if (held === undefined || reading.key.localeCompare(held.key) < 0) {
      group.set(reading.source, reading);
    }
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => {
      const readings = [...group.values()];
      const { measure, day } = readings[0]!;
      return decideOccasion(
        { measure, day },
        readings.map(({ key, source, value, unit, shown }) => ({
          key,
          source,
          value,
          unit,
          shown,
        })),
        judge,
      );
    })
    .sort(
      (a, b) =>
        (b.day ?? "").localeCompare(a.day ?? "") ||
        SOURCE_MEASURES.indexOf(a.measure) - SOURCE_MEASURES.indexOf(b.measure),
    );
};

const label = (source: WearableSourceId): string => WEARABLE_SOURCE_LABEL[source];

const joinNames = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const toleranceText = (tolerance: Tolerance): string => {
  const number = tolerance.absolute.toLocaleString("en-GB");
  // A tolerance on a percentage is in points: 96% and 97% are one point apart.
  const absolute =
    tolerance.unit === "%"
      ? `${number} percentage point${tolerance.absolute === 1 ? "" : "s"}`
      : `${number} ${tolerance.unit}`;
  return tolerance.relative > 0
    ? `${absolute} or ${Math.round(tolerance.relative * 100)}%`
    : absolute;
};

const GRADE_WORDS: Readonly<Record<EvidenceGrade, string>> = {
  good: "good",
  fair: "fair",
  poor: "poor",
  unknown: "no published grade",
};

const gradeOf = (
  grades: Readonly<Partial<Record<WearableSourceId, EvidenceGrade>>>,
  source: WearableSourceId,
): EvidenceGrade => grades[source] ?? "unknown";

/** After "Held back: Oura and WHOOP"; the numbers are left out, so nothing invites a guess. */
const HOLD_WORDS: Readonly<Record<HoldReason, (measure: string) => string>> = {
  no_evidence: (measure) =>
    `disagree on ${measure}, and no published validation covers these sources for it`,
  evidence_tie: (measure) =>
    `disagree on ${measure}, and published validation grades them the same`,
  no_dependable_source: (measure) =>
    `disagree on ${measure}, and published validation finds no source dependable for it`,
  units_differ: (measure) =>
    `record ${measure} in different units, so they cannot be compared`,
  no_day: (measure) =>
    `record ${measure} without a day, so the app cannot tell they describe the same one`,
};

const readingsText = (readings: readonly SourceReading[]): string =>
  joinNames(readings.map((reading) => `${label(reading.source)} ${reading.shown}`));

/**
 * The rule behind a decision in one plain sentence, or null when only one
 * source had a reading (its provenance line already names it).
 */
export const decisionLine = (decision: SourceDecision): string | null => {
  const measure = MEASURE_LABEL[decision.measure];
  switch (decision.kind) {
    case "only_source":
      return null;
    case "agree":
      return `${joinNames(decision.others.map((reading) => label(reading.source)))} ${
        decision.others.length === 1 ? "agrees" : "agree"
      } within ${toleranceText(SOURCE_TOLERANCE[decision.measure])} (${readingsText(decision.others)}); ${label(decision.chosen.source)}'s reading is shown.`;
    case "evidence": {
      const chosen = decision.chosen.source;
      const others = decision.others
        .map(
          (reading) =>
            `${label(reading.source)} ${GRADE_WORDS[gradeOf(decision.grades, reading.source)]}`,
        )
        .join(", ");
      return `Sources disagree (${readingsText(decision.others)}). ${label(chosen)} is used: published validation grades it ${GRADE_WORDS[gradeOf(decision.grades, chosen)]} for ${measure} (${others}).`;
    }
    case "held_back":
      return `Held back: ${joinNames(decision.readings.map((reading) => label(reading.source)))} ${HOLD_WORDS[decision.reason](measure)}.`;
  }
};

/** What a chosen reading carries, so the chat's cited value can say why it was used. */
export type SourceRuleNote = Readonly<{
  kind: "agree" | "evidence";
  line: string;
}>;

/** A measure and day the app holds back, carried with the summaries it was taken from. */
export type HeldBackNote = Readonly<{
  measure: SourceMeasure;
  day: string | null;
  keys: readonly string[];
  sources: readonly WearableSourceId[];
  reason: HoldReason;
  line: string;
}>;

export const heldBackNote = (
  decision: Extract<SourceDecision, { kind: "held_back" }>,
): HeldBackNote => ({
  measure: decision.measure,
  day: decision.day,
  keys: decision.readings.map((reading) => reading.key),
  sources: decision.readings.map((reading) => reading.source),
  reason: decision.reason,
  line: decisionLine(decision) ?? "",
});

const isSourceRuleKind = (value: unknown): value is SourceRuleNote["kind"] =>
  value === "agree" || value === "evidence";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/** A note read back from JSON (a stored answer, an API body), or null. Checked, not trusted. */
export const parseSourceRule = (note: unknown): SourceRuleNote | null =>
  isRecord(note) &&
  isSourceRuleKind(note.kind) &&
  typeof note.line === "string" &&
  note.line !== ""
    ? { kind: note.kind, line: note.line }
    : null;

/** The rule line under a cited value, or null. */
export const sourceRuleLine = (note: unknown): string | null =>
  parseSourceRule(note)?.line ?? null;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === "string");

const isSourceList = (value: unknown): value is readonly WearableSourceId[] =>
  Array.isArray(value) &&
  value.every((item: unknown) => isOneOf(WEARABLE_SOURCE_IDS, item));

/** Held-back notes read back from an API body; anything malformed is dropped. */
export const parseHeldBackNotes = (value: unknown): readonly HeldBackNote[] =>
  Array.isArray(value)
    ? value.flatMap((note: unknown): readonly HeldBackNote[] => {
        if (!isRecord(note)) return [];
        const { measure, day, keys, sources, reason, line } = note;
        if (
          !isOneOf(SOURCE_MEASURES, measure) ||
          !(day === null || typeof day === "string") ||
          !isStringList(keys) ||
          !isSourceList(sources) ||
          !isOneOf(HOLD_REASONS, reason) ||
          typeof line !== "string"
        ) {
          return [];
        }
        return [{ measure, day, keys, sources, reason, line }];
      })
    : [];
