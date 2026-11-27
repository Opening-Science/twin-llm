/**
 * Copied from open-twin@2fd26911c43c3007c8b87a88bf8a3647fa90ded0 (MIT, Open Science
 * Foundation): `packages/fhir-core/src/reliability.ts` (the graded table and
 * `reliabilityFor`) and `packages/aggregate/src/select.ts` (`selectSource`), with the
 * `Measure` type from `packages/aggregate/src/measure.ts`. Removed upstream in #300,
 * which replaced evidence grades with user-owned source preferences. TwinLLM keeps
 * them for the wearable source rules' evidence step (#464). Rows, wording and logic
 * are unchanged; only the module shape follows this repo's style.
 */

/** The measure vocabulary used by `reliabilityFor`. */
export type Measure =
  | "total-sleep-time"
  | "sleep-staging"
  | "sleep-wake-detection"
  | "step-count"
  | "energy-expenditure"
  | "oxygen-saturation"
  | "resting-heart-rate"
  | "heart-rate-variability"
  | "vo2max";

/**
 * `good`      — validated against a clinical reference with small, characterised error.
 * `fair`      — usable for trends; error large enough to matter for a single reading.
 * `poor`      — published error so large that no source is dependable for this measure.
 * `unknown`   — no validation study found for this source and measure.
 */
export type ReliabilityGrade = "good" | "fair" | "poor" | "unknown";

export type ReliabilityFinding = Readonly<{
  /** The connector, matching the `connector` field used in bundle provenance tags. */
  source: string;
  /** What is being measured, in this project's own vocabulary. */
  measure: string;
  grade: ReliabilityGrade;
  /** The number that justifies the grade. Quoted, not paraphrased. */
  evidence: string;
  citation: string;
}>;

/**
 * Deliberately sparse. An absent row means nobody has looked, which a consumer must
 * be able to tell apart from a row saying the source is poor.
 */
export const RELIABILITY: readonly ReliabilityFinding[] = [
  {
    source: "oura",
    measure: "sleep-wake-detection",
    grade: "good",
    evidence:
      "Oura Gen3 with OSSA 2.0 identified sleep epochs with 94.4-94.5% sensitivity against ambulatory polysomnography, over 96 participants and 421,045 epochs — one of the largest validation datasets published for any consumer sleep wearable.",
    citation:
      "Sleep Medicine, Jan 2024. https://www.sciencedirect.com/science/article/pii/S1389945724000200",
  },
  {
    source: "oura",
    measure: "sleep-staging",
    grade: "fair",
    evidence:
      "Best of the consumer devices compared — 5% more accurate than Apple Watch and 10% more than Fitbit on four-stage classification — but four-stage accuracy sits at 60-75% across every device studied, so a single night is a trend and not a measurement.",
    citation:
      "Sensors 2024 (Brigham and Women's Hospital); SLEEP Advances 2025. https://academic.oup.com/sleepadvances/article/6/2/zpaf021/8090472",
  },
  {
    source: "oura",
    measure: "heart-rate-variability",
    grade: "good",
    evidence:
      "Oura Gen3 and Oura 4 showed the strongest agreement for HRV and resting heart rate of the devices tested, ahead of WHOOP, Garmin and Polar.",
    citation: "The Physiological Society, independent peer-reviewed comparison.",
  },
  {
    source: "oura",
    measure: "resting-heart-rate",
    grade: "good",
    evidence:
      "As above — strongest agreement for resting heart rate among the devices compared.",
    citation: "The Physiological Society, independent peer-reviewed comparison.",
  },
  {
    source: "google-health",
    measure: "total-sleep-time",
    grade: "fair",
    evidence:
      "Fitbit devices, reached through this connector, show small signed bias for total sleep time: Charge 5 +6.31 min, Sense +11.12 min against polysomnography. Total sleep time is the sleep measure every device gets closest to right.",
    citation:
      "Schyvens et al., six-device validation, 2025. https://academic.oup.com/sleepadvances/article/6/2/zpaf021/8090472",
  },
  {
    source: "google-health",
    measure: "step-count",
    grade: "good",
    evidence:
      "Fitbit Charge and Charge HR were consistently accurate for step counts across 20 studies, with mean absolute percentage error below 25%.",
    citation:
      "JMIR mHealth uHealth 2020, systematic review. https://mhealth.jmir.org/2020/9/e18694/",
  },
  {
    // The single most useful row here, because it contradicts the assumption that a
    // "best source for exercise" exists.
    source: "*",
    measure: "energy-expenditure",
    grade: "poor",
    evidence:
      'Mean absolute percentage error above 30% for every brand tested; for Apple Watch, between 30.77% and 155.05%. The review\'s own conclusion: "None of the tested devices proved to be accurate in measuring energy expenditure." Selecting a best source for calories is choosing among unreliable options.',
    citation:
      "JMIR mHealth uHealth 2020, systematic review. https://mhealth.jmir.org/2020/9/e18694/",
  },
  {
    source: "*",
    measure: "sleep-staging",
    grade: "fair",
    evidence:
      "Four-stage sleep classification accuracy falls in the 60-75% band across consumer wearables, while sleep-versus-wake sensitivity commonly exceeds 90%. The two must not be graded together.",
    citation: "Meta-analysis of wrist-worn sleep trackers versus polysomnography, 2024.",
  },
  {
    source: "*",
    measure: "oxygen-saturation",
    grade: "fair",
    evidence:
      "Apple Watch differed from clinical pulse oximetry by 0.8% in chronic lung disease, but a dedicated oximeter fell within a 2% error band far more often than a smartwatch (49.03% vs 32.14%), and Garmin error grew from 4.7% to 13.1% between sea level and 5500 m. Altitude and perfusion matter more than the brand.",
    citation: "Lancet Respiratory Medicine 2022; JMIR Formative Research 2026.",
  },
  {
    source: "*",
    measure: "vo2max",
    grade: "fair",
    evidence:
      "Garmin fēnix 6 estimated VO2max with 7.05% mean absolute percentage error and a concordance correlation of 0.73 against a metabolic cart. Every consumer VO2max is a model output rather than a measured peak, which is why the emitting code records it as device-estimated.",
    citation: "Sensors 2025, 25(1):275. https://www.mdpi.com/1424-8220/25/1/275",
  },
];

/**
 * Findings for a (source, measure) pair, most specific first. A `*` source row
 * applies to every source and is how "no device is good at this" is expressed.
 *
 * Returns an empty array when nobody has studied it. That is a different answer from
 * "this source is poor", and a caller that conflates the two will present a guess as
 * a finding.
 */
export const reliabilityFor = (source: string, measure: string): ReliabilityFinding[] =>
  RELIABILITY.filter(
    (r) => r.measure === measure && (r.source === source || r.source === "*"),
  ).sort((a, b) => (a.source === "*" ? 1 : b.source === "*" ? -1 : 0));

/**
 * Choosing between two connectors that measured the same thing.
 *
 * The rule is an evidence lookup, not a preference order. The table above records
 * what the validation literature says about a (source, measure) pair, and this reads
 * it — so "Oura is best for sleep" is never assumed, and is in fact wrong as stated:
 * Oura is good at separating sleep from wake and only fair at staging it, and those
 * are different measures with different answers.
 *
 * The most important outcome here is the refusal. Energy expenditure has a published
 * mean absolute percentage error above 30% on every brand tested, so there is no good
 * source to pick — and naming a winner would present a confidence nobody has earned.
 * Where the evidence says no source is dependable, every reading is kept and no
 * derived value is asserted at all.
 */
const RANK: Readonly<Record<ReliabilityGrade, number>> = {
  good: 3,
  fair: 2,
  unknown: 1,
  poor: 0,
};

export type Candidate = Readonly<{
  /** The connector the reading came from, matching `ReliabilityFinding.source`. */
  connector: string;
}>;

export type Selection<T extends Candidate> =
  { kind: "selected"; winner: T; policy: string } | { kind: "abstained"; reason: string };

/** The best grade published for this connector and measure, and the finding behind it. */
const gradeFor = (
  connector: string,
  measure: Measure,
): { grade: ReliabilityGrade; finding?: ReliabilityFinding } => {
  // `reliabilityFor` returns source-specific findings before the `*` ones that apply to
  // everything, so the first is the most specific statement about this connector.
  const finding = reliabilityFor(connector, measure)[0];
  return { grade: finding?.grade ?? "unknown", finding };
};

/**
 * Picks a source, or declines to.
 *
 * Declines when the literature says nothing about any candidate — an arbitrary winner
 * dressed as a judgement is worse than no winner — and when a `poor` grade applies,
 * which is the "no source is dependable for this" case rather than a low ranking.
 */
export const selectSource = <T extends Candidate>(
  candidates: readonly T[],
  measure: Measure,
): Selection<T> => {
  const first = candidates[0];
  if (!first) return { kind: "abstained", reason: "no candidates" };
  if (candidates.length === 1) {
    return {
      kind: "abstained",
      reason: "only one source reported this measure, so nothing was selected",
    };
  }

  const graded = candidates.map((candidate) => ({
    candidate,
    ...gradeFor(candidate.connector, measure),
  }));

  const poor = graded.find((entry) => entry.grade === "poor");
  if (poor) {
    return {
      kind: "abstained",
      reason:
        `No source is dependable for ${measure}, so every reading is kept and none is preferred. ` +
        (poor.finding?.evidence ?? ""),
    };
  }

  if (graded.every((entry) => entry.grade === "unknown")) {
    return {
      kind: "abstained",
      reason: `No validation evidence was found for ${measure} from any of these sources, so none was preferred.`,
    };
  }

  const best = graded.reduce((a, b) => (RANK[b.grade] > RANK[a.grade] ? b : a));
  const runnerUp = graded.filter((entry) => entry.candidate !== best.candidate);
  // A tie is not a selection. Two sources graded alike give no reason to prefer either,
  // and picking on array order would encode the request order as a clinical judgement.
  if (runnerUp.some((entry) => RANK[entry.grade] === RANK[best.grade])) {
    return {
      kind: "abstained",
      reason:
        `${measure}: the evidence grades these sources equally (${best.grade}), ` +
        "so there is no basis to prefer one and all readings are kept.",
    };
  }

  const others = runnerUp
    .map((entry) => `${entry.candidate.connector} (${entry.grade})`)
    .join(", ");
  return {
    kind: "selected",
    winner: best.candidate,
    policy:
      `${best.candidate.connector} selected for ${measure}: graded ${best.grade} against ${others}. ` +
      `${best.finding?.evidence ?? ""} — ${best.finding?.citation ?? ""}`.trim(),
  };
};
