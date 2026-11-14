/**
 * WHAT: Graded validation evidence table per (source, measure) with citations.
 * NOT:  Must not invent grades without a cited finding; selection policy lives in aggregate.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d3; DECISIONS.md#d4
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Grades are literature-backed claims — treat CORRECTNESS of each row as the cited paper, not this module alone.
 */
/**
 * `good`      — validated against a clinical reference with small, characterised error.
 * `fair`      — usable for trends; error large enough to matter for a single reading.
 * `poor`      — published error so large that no source is dependable for this measure.
 * `unknown`   — no validation study found for this source and measure.
 */
export type ReliabilityGrade = 'good' | 'fair' | 'poor' | 'unknown';

export interface ReliabilityFinding {
  /** The connector, matching the `connector` field used in bundle provenance tags. */
  source: string;
  /** What is being measured, in this project's own vocabulary. */
  measure: string;
  grade: ReliabilityGrade;
  /** The number that justifies the grade. Quoted, not paraphrased. */
  evidence: string;
  citation: string;
}

/**
 * Deliberately sparse. An absent row means nobody has looked, which a consumer must
 * be able to tell apart from a row saying the source is poor.
 */
export const RELIABILITY: readonly ReliabilityFinding[] = [
  {
    source: 'oura',
    measure: 'sleep-wake-detection',
    grade: 'good',
    evidence:
      'Oura Gen3 with OSSA 2.0 identified sleep epochs with 94.4-94.5% sensitivity against ambulatory polysomnography, over 96 participants and 421,045 epochs — one of the largest validation datasets published for any consumer sleep wearable.',
    citation: 'Sleep Medicine, Jan 2024. https://www.sciencedirect.com/science/article/pii/S1389945724000200'
  },
  {
    source: 'oura',
    measure: 'sleep-staging',
    grade: 'fair',
    evidence:
      'Best of the consumer devices compared — 5% more accurate than Apple Watch and 10% more than Fitbit on four-stage classification — but four-stage accuracy sits at 60-75% across every device studied, so a single night is a trend and not a measurement.',
    citation:
      "Sensors 2024 (Brigham and Women's Hospital); SLEEP Advances 2025. https://academic.oup.com/sleepadvances/article/6/2/zpaf021/8090472"
  },
  {
    source: 'oura',
    measure: 'heart-rate-variability',
    grade: 'good',
    evidence:
      'Oura Gen3 and Oura 4 showed the strongest agreement for HRV and resting heart rate of the devices tested, ahead of WHOOP, Garmin and Polar.',
    citation: 'The Physiological Society, independent peer-reviewed comparison.'
  },
  {
    source: 'oura',
    measure: 'resting-heart-rate',
    grade: 'good',
    evidence: 'As above — strongest agreement for resting heart rate among the devices compared.',
    citation: 'The Physiological Society, independent peer-reviewed comparison.'
  },
  {
    source: 'google-health',
    measure: 'total-sleep-time',
    grade: 'fair',
    evidence:
      'Fitbit devices, reached through this connector, show small signed bias for total sleep time: Charge 5 +6.31 min, Sense +11.12 min against polysomnography. Total sleep time is the sleep measure every device gets closest to right.',
    citation:
      'Schyvens et al., six-device validation, 2025. https://academic.oup.com/sleepadvances/article/6/2/zpaf021/8090472'
  },
  {
    source: 'google-health',
    measure: 'step-count',
    grade: 'good',
    evidence:
      'Fitbit Charge and Charge HR were consistently accurate for step counts across 20 studies, with mean absolute percentage error below 25%.',
    citation: 'JMIR mHealth uHealth 2020, systematic review. https://mhealth.jmir.org/2020/9/e18694/'
  },
  {
    // The single most useful row here, because it contradicts the assumption that a
    // "best source for exercise" exists.
    source: '*',
    measure: 'energy-expenditure',
    grade: 'poor',
    evidence:
      'Mean absolute percentage error above 30% for every brand tested; for Apple Watch, between 30.77% and 155.05%. The review\'s own conclusion: "None of the tested devices proved to be accurate in measuring energy expenditure." Selecting a best source for calories is choosing among unreliable options.',
    citation: 'JMIR mHealth uHealth 2020, systematic review. https://mhealth.jmir.org/2020/9/e18694/'
  },
  {
    source: '*',
    measure: 'sleep-staging',
    grade: 'fair',
    evidence:
      'Four-stage sleep classification accuracy falls in the 60-75% band across consumer wearables, while sleep-versus-wake sensitivity commonly exceeds 90%. The two must not be graded together.',
    citation: 'Meta-analysis of wrist-worn sleep trackers versus polysomnography, 2024.'
  },
  {
    source: '*',
    measure: 'oxygen-saturation',
    grade: 'fair',
    evidence:
      'Apple Watch differed from clinical pulse oximetry by 0.8% in chronic lung disease, but a dedicated oximeter fell within a 2% error band far more often than a smartwatch (49.03% vs 32.14%), and Garmin error grew from 4.7% to 13.1% between sea level and 5500 m. Altitude and perfusion matter more than the brand.',
    citation: 'Lancet Respiratory Medicine 2022; JMIR Formative Research 2026.'
  },
  {
    source: '*',
    measure: 'vo2max',
    grade: 'fair',
    evidence:
      'Garmin fēnix 6 estimated VO2max with 7.05% mean absolute percentage error and a concordance correlation of 0.73 against a metabolic cart. Every consumer VO2max is a model output rather than a measured peak, which is why the emitting code records it as device-estimated.',
    citation: 'Sensors 2025, 25(1):275. https://www.mdpi.com/1424-8220/25/1/275'
  }
];

/**
 * Findings for a (source, measure) pair, most specific first. A `*` source row
 * applies to every source and is how "no device is good at this" is expressed.
 *
 * Returns an empty array when nobody has studied it. That is a different answer from
 * "this source is poor", and a caller that conflates the two will present a guess as
 * a finding.
 */
export function reliabilityFor(source: string, measure: string): ReliabilityFinding[] {
  return RELIABILITY.filter((r) => r.measure === measure && (r.source === source || r.source === '*')).sort((a, b) =>
    a.source === '*' ? 1 : b.source === '*' ? -1 : 0
  );
}
