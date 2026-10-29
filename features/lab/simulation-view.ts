import { type CsvCell, toCsv } from "@/infrastructure/csv";
import { EMPTY_VALUE, formatDate, formatNumber } from "@/infrastructure/format-measure";
import { type ToolRefusal } from "@/packages/query-tools/refusals";
import {
  type RecordingPlan,
  type RhythmGroundTruth,
} from "@/packages/query-tools/rhythm-recording";
import { type RhythmIrregularityResult } from "@/packages/query-tools/rhythm-tools";
import {
  IRREGULARITY_THRESHOLDS,
  randomTurningPointRange,
} from "@/packages/query-tools/stats";
import { type Recording } from "@/packages/rhythm-sim/simulate-recording";

import { type Evidence, type EvidenceTable } from "./lab-check";

/**
 * Shapes one simulated recording for the Lab's Simulations view: the
 * tachogram, the first seconds of the pulse-wave proxy, the metrics the
 * `rhythm_irregularity` tool gives, and the simulator's settings. Pure; the
 * server makes the recording and the page only draws this.
 *
 * Wording describes the recording and the research flag, never a person.
 * The simulator's settings are for this researcher's view only; the tool's
 * output to a model never holds them.
 */

export type ChartPoint = Readonly<{ t: number; value: number }>;
export type Span = Readonly<{ start: number; end: number }>;

/** One point per RR interval, at the beat that ends it: (s, ms). */
export const tachogramPoints = (recording: Recording): readonly ChartPoint[] =>
  recording.rrMs.map((rr, index) => ({
    t: (recording.beatTimesMs[index + 1] ?? 0) / 1000,
    value: rr,
  }));

/** The windows the research flag marks, in seconds from the first beat. */
export const flaggedSpans = (
  metrics: RhythmIrregularityResult | ToolRefusal,
): readonly Span[] =>
  "windows" in metrics
    ? metrics.windows
        .filter((window) => window.flagged)
        .map((window) => ({ start: window.start_sec, end: window.end_sec }))
    : [];

export const PULSE_STRIP_SEC = 10;

/** The pulse-wave proxy's first `seconds` (or the whole recording if shorter). */
export const pulseStrip = (
  recording: Recording,
  seconds = PULSE_STRIP_SEC,
): readonly ChartPoint[] => {
  const rate = recording.pulseWave.sampleRateHz;
  return recording.pulseWave.values
    .slice(0, Math.round(seconds * rate))
    .map((value, index) => ({ t: index / rate, value }));
};

const decimals3 = (value: number | null): string => formatNumber(value, 3);

export const WINDOW_COLUMNS = [
  "Window",
  "Start (s)",
  "End (s)",
  "Intervals",
  "nRMSSD",
  "Turning-point ratio",
  "Shannon entropy",
  "Sample entropy",
  "Research flag",
] as const;

/** The metrics per window, as the page shows them. */
export const windowTable = (metrics: RhythmIrregularityResult): EvidenceTable => ({
  caption: "Irregularity metrics per 128-interval window",
  columns: WINDOW_COLUMNS,
  rows: metrics.windows.map((window, index) => [
    String(index + 1),
    formatNumber(window.start_sec, 1),
    formatNumber(window.end_sec, 1),
    String(window.n),
    decimals3(window.nrmssd),
    decimals3(window.turning_point_ratio),
    decimals3(window.shannon_entropy),
    decimals3(window.sample_entropy),
    window.flagged ? "Marked" : "Not marked",
  ]),
});

/** The same table with unrounded numbers, for a paper's figure. */
export const windowCsv = (metrics: RhythmIrregularityResult): string =>
  toCsv(
    [
      "window",
      "start_sec",
      "end_sec",
      "n",
      "nrmssd",
      "turning_point_ratio",
      "shannon_entropy",
      "sample_entropy",
      "flagged",
    ],
    metrics.windows.map((window, index): readonly CsvCell[] => [
      index + 1,
      window.start_sec,
      window.end_sec,
      window.n,
      window.nrmssd,
      window.turning_point_ratio,
      window.shannon_entropy,
      window.sample_entropy,
      window.flagged,
    ]),
  );

/** Every RR interval with its beat time and whether a marked window holds it. */
export const intervalCsv = (recording: Recording, spans: readonly Span[]): string =>
  toCsv(
    ["beat", "time_sec", "rr_ms", "in_flagged_window"],
    tachogramPoints(recording).map((point, index) => [
      index + 1,
      point.t,
      point.value,
      spans.some((span) => point.t > span.start && point.t <= span.end),
    ]),
  );

/** What each metric is compared with, and where the threshold comes from. */
export const thresholdTable = (): EvidenceTable => {
  const band = randomTurningPointRange(IRREGULARITY_THRESHOLDS.windowBeats);
  return {
    caption: "Research thresholds and their sources",
    columns: ["Metric", "Research threshold", "Source", "In the flag"],
    rows: [
      [
        "nRMSSD",
        `above ${formatNumber(IRREGULARITY_THRESHOLDS.nrmssdAbove, 1)}`,
        "Dash et al. 2009",
        "Yes",
      ],
      [
        "Turning-point ratio",
        `${formatNumber(band.low, 3)} to ${formatNumber(band.high, 3)} (99.9 % band of random values at 128)`,
        "Dash et al. 2009",
        "Yes",
      ],
      [
        "Shannon entropy (16 bins)",
        `above ${formatNumber(IRREGULARITY_THRESHOLDS.entropyAbove, 1)} in the paper`,
        "Dash et al. 2009",
        "No: reported, not validated here",
      ],
      [
        "Sample entropy (m 2, r 0.2 SD)",
        "none",
        "Richman and Moorman 2000",
        "No: reported only",
      ],
    ],
  };
};

const percent = (share: number): string => `${formatNumber(share * 100, 0)} %`;

/** The recording's totals, as the tool reports them. */
export const metricsSummary = (
  metrics: RhythmIrregularityResult,
): readonly Evidence[] => [
  { label: "RR intervals", value: formatNumber(metrics.n, 0) },
  { label: "Mean heart rate", value: `${formatNumber(metrics.mean_hr, 1)} /min` },
  {
    label: "Windows",
    value: `${metrics.n_windows} of ${metrics.window_beats} intervals each`,
  },
  {
    label: "Marked by the research flag",
    value: `${metrics.n_flagged} of ${metrics.n_windows} windows, ${percent(metrics.flagged_time_share)} of the time`,
  },
];

const RHYTHM_SETTING: Readonly<Record<RhythmGroundTruth["profile"], string>> = {
  sinus: "Sinus rhythm, with any premature beats below",
  paroxysmal_af: "Sinus rhythm with an atrial fibrillation episode",
};

const seconds = (value: number): string => `${formatNumber(value, 0)} s`;

/**
 * What the simulator was set to and put in this recording. Known only
 * because the person is simulated; shown in the Lab, never to a model.
 */
export const simulatorSettings = (
  plan: RecordingPlan,
  recording: Recording,
  truth: RhythmGroundTruth,
): readonly Evidence[] => {
  const config = recording.config;
  return [
    { label: "Rhythm setting", value: RHYTHM_SETTING[truth.profile] },
    {
      label: "Atrial fibrillation episodes",
      value:
        truth.afEpisodes.length === 0
          ? "None"
          : truth.afEpisodes
              .map(
                (episode) => `${seconds(episode.startSec)} to ${seconds(episode.endSec)}`,
              )
              .join(", "),
    },
    { label: "Intervals made in AF", value: percent(truth.afIntervalShare) },
    { label: "Premature atrial beats", value: String(truth.pac) },
    { label: "Premature ventricular beats", value: String(truth.pvc) },
    {
      label: "Synthea record",
      value: plan.afConditionActive
        ? "An atrial fibrillation condition (SNOMED CT 49436004) overlaps this day"
        : "No atrial fibrillation condition (SNOMED CT 49436004) on this day",
    },
    { label: "Sinus mean rate", value: `${formatNumber(config.meanHr, 0)} /min` },
    { label: "Sinus RR spread (SD)", value: `${formatNumber(config.rrSdMs, 0)} ms` },
    {
      label: "Breathing rate (HF peak)",
      value: `${formatNumber(config.respRateHz, 2)} Hz`,
    },
    { label: "AF mean rate", value: `${formatNumber(config.afMeanHr, 0)} /min` },
    { label: "AF coefficient of variation", value: formatNumber(config.afCv, 2) },
    { label: "Seed", value: String(config.seed), mono: true },
  ];
};

/** "Recording 1 on 1 Jun 2025, 300 s". */
export const recordingTitle = (plan: RecordingPlan): string =>
  `Recording ${plan.recording} on ${formatDate(plan.date)}, ${plan.durationSec} s`;

/** A file name stem for this recording's downloads. */
export const recordingFileStem = (plan: RecordingPlan): string =>
  `rhythm-sim-${plan.subjectRef.slice(0, 8)}-${plan.date}-r${plan.recording}`;

/** When the tool refuses this recording, the sentence the page shows instead. */
export const refusalSentence = (refusal: ToolRefusal): string => {
  switch (refusal.code) {
    case "WINDOW_TOO_SHORT":
      return "This recording has fewer than 128 intervals, too few for one analysis window, so it has no metrics. Try a longer recording.";
    case "OUTSIDE_SUBJECT_WINDOW":
      return "window" in refusal && refusal.window.start !== null
        ? `This person's observations run from ${formatDate(refusal.window.start)} to ${formatDate(refusal.window.end)}. Pick a day in between, or leave the date empty for the last one.`
        : "This person has no observations, so there is no day to make a recording on.";
    case "SUBJECT_SCOPE_VIOLATION":
      return "That person is not in the synthetic cohorts this page can read.";
    case "NO_RHYTHM_DATA":
      return "Recordings are made for synthetic people only.";
    default:
      return EMPTY_VALUE;
  }
};
