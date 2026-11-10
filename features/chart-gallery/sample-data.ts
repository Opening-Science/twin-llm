/**
 * Made-up data for the chart gallery. Nothing here is a person's: the
 * numbers are invented to show each chart's shape, and the research figures
 * use the published summary values from docs/research, not any subject.
 */

import { formatClock } from "@/infrastructure/charts/kit";
import type { DaySample, Range, StageSpan, StreakDay } from "@/infrastructure/charts/kit";

/** A smooth running total over the day, `total` by midnight. */
const curve = (total: number, steps = 24): readonly DaySample[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const at = i / steps;
    // Little at night, most in the day: a logistic around midday.
    const share = 1 / (1 + Math.exp(-10 * (at - 0.55)));
    const start = 1 / (1 + Math.exp(5.5));
    const end = 1 / (1 + Math.exp(-4.5));
    return { at, value: Math.round(((share - start) / (end - start)) * total) };
  });

export const DAY_AVERAGE = curve(8_400);
export const DAY_TODAY = curve(7_200, 24).filter((s) => s.at <= 0.62);
export const DAY_NOW = 0.62;

export const WEEK_STEPS = [6_820, 9_140, 7_310, 10_420, 5_980, 11_250, 8_060];
export const WEEK_STEPS_AVERAGE = 8_426;

export const STREAK: readonly StreakDay[] = Array.from({ length: 28 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 9, 12 + i));
  return {
    date: day.toISOString().slice(0, 10),
    done: ![3, 4, 11, 17, 18, 24].includes(i),
  };
});
export const STREAK_TODAY = "2026-11-08";

export const HEART_RANGES: readonly (Range | null)[] = [
  { min: 58, max: 71 },
  { min: 56, max: 66 },
  { min: 61, max: 88 },
  { min: 64, max: 97 },
  { min: 70, max: 114 },
  null,
  { min: 66, max: 92 },
  { min: 62, max: 85 },
  { min: 60, max: 79 },
  { min: 59, max: 74 },
];

export const NIGHT: readonly StageSpan[] = [
  { stage: "awake", start: 0, end: 12 },
  { stage: "core", start: 12, end: 70 },
  { stage: "deep", start: 70, end: 118 },
  { stage: "core", start: 118, end: 160 },
  { stage: "rem", start: 160, end: 186 },
  { stage: "core", start: 186, end: 240 },
  { stage: "deep", start: 240, end: 262 },
  { stage: "core", start: 262, end: 300 },
  { stage: "awake", start: 300, end: 306 },
  { stage: "rem", start: 306, end: 344 },
  { stage: "core", start: 344, end: 400 },
  { stage: "rem", start: 400, end: 432 },
  { stage: "awake", start: 432, end: 439 },
];

export const SLEEP_PARTS = [
  { label: "Duration", value: 46, max: 50 },
  { label: "Bedtime", value: 24, max: 30 },
  { label: "Interruptions", value: 14, max: 20 },
];

/** Minutes after 22:00, 14 nights. */
export const BEDTIMES = [62, 48, 81, 55, 70, 44, 90, 58, 66, 52, 75, 61, 49, 108];
/** The usual bedtime the heroes show, 23:04. */
export const BEDTIME_USUAL = 64;

/** P3 within-person effect, docs/research: 3.09 (2.07 to 4.63) against a shuffled null. */
export const P3_ESTIMATES = [
  { label: "Within person", estimate: 3.09, low: 2.07, high: 4.63 },
  { label: "Rule change, before", estimate: 1.91 },
  { label: "Rule change, after", estimate: 3.95 },
];

/** P2 AF detection, docs/research. */
export const P2_GROUPS = [
  {
    label: "AFDB",
    estimates: [
      { label: "Sensitivity", estimate: 0.954 },
      { label: "Specificity", estimate: 0.796 },
    ],
  },
  {
    label: "LTAFDB",
    estimates: [
      { label: "Sensitivity", estimate: 0.947 },
      { label: "Specificity", estimate: 0.841 },
    ],
  },
] as const;

/** A made-up null around 0.5 and a made-up observed AUC, not P4's, deterministic so screenshots match. */
export const NULL_DRAWS = Array.from({ length: 400 }, (_, i) => {
  const u = ((i * 7919) % 400) / 400;
  const v = ((i * 104_729) % 397) / 397;
  return 0.5 + 0.035 * Math.sqrt(-2 * Math.log(u || 0.5)) * Math.cos(2 * Math.PI * v);
});
export const NULL_OBSERVED = 0.58;

/** Last night against the 7-night usual, in minutes. */
export const RADAR_SLEEP = [
  { label: "REM", value: 96, display: "1 hr 36 min", reference: 88, max: 150 },
  { label: "Deep", value: 70, display: "1 hr 10 min", reference: 62, max: 120 },
  { label: "Core", value: 248, display: "4 hr 8 min", reference: 230, max: 330 },
  { label: "Awake", value: 25, display: "25 min", reference: 31, max: 60 },
];

/** Heart today against the usual; each on its own scale. */
export const RADAR_HEART = [
  { label: "Resting", value: 58, display: "58 bpm", reference: 61, max: 100 },
  { label: "Sleeping", value: 52, display: "52 bpm", reference: 54, max: 100 },
  { label: "Walking", value: 96, display: "96 bpm", reference: 92, max: 160 },
  { label: "Workout", value: 138, display: "138 bpm", reference: 131, max: 190 },
  { label: "HRV", value: 47, display: "47 ms", reference: 42, max: 100 },
];

/** A three-part score, with HRV not yet recorded today. */
export const RADAR_READINESS = [
  { label: "Sleep", value: 82, display: "82", reference: 76, max: 100 },
  { label: "Recovery", value: 68, display: "68", reference: 71, max: 100 },
  { label: "HRV balance", value: null, display: "", reference: 64, max: 100 },
];

/* --- Readouts for the interactive examples, all made up ---------------------- */

const steps = (n: number): string => `${n.toLocaleString("en-US")} steps`;

/** The hour nearest a share of the day, "14:00", in the display locale. */
const clock = (at: number): string => formatClock(Math.round(at * 24) * 60);

export const DAY_TODAY_READ = DAY_TODAY.map((s) => ({
  ...s,
  readout: `${clock(s.at)} · ${steps(s.value)}`,
}));

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEK_STEPS_READOUTS = WEEK_STEPS.map(
  (n, i) => `${WEEKDAYS[i]} · ${steps(n)}`,
);

export const HEART_RANGES_READ: readonly (Range | null)[] = HEART_RANGES.map((r, i) =>
  r ? { ...r, readout: `${clock((8 + i) / 24)} · ${r.min} to ${r.max} bpm` } : null,
);

/** Minutes after 22:00 as a clock time, "23:02". */
const bedtime = (minutes: number): string => formatClock(22 * 60 + minutes);

export const BEDTIME_READOUTS = BEDTIMES.map((m, i) => {
  const day = new Date(Date.UTC(2026, 9, 25 + i));
  const date = `${day.getUTCDate()} ${day.getUTCMonth() === 9 ? "Oct" : "Nov"}`;
  return `${date} · ${bedtime(m)}`;
});

export const P3_ESTIMATES_READ = P3_ESTIMATES.map((e) => ({
  ...e,
  readout:
    e.low === undefined
      ? `${e.label} · ${e.estimate.toFixed(2)}`
      : `${e.label} · ${e.estimate.toFixed(2)} (${e.low.toFixed(2)} to ${e.high.toFixed(2)})`,
}));

export const P2_GROUPS_READ = P2_GROUPS.map((g) => ({
  label: g.label,
  estimates: [
    {
      ...g.estimates[0],
      readout: `${g.label} · ${g.estimates[0].label} ${g.estimates[0].estimate}`,
    },
    {
      ...g.estimates[1],
      readout: `${g.label} · ${g.estimates[1].label} ${g.estimates[1].estimate}`,
    },
  ] as const,
}));

/** Made-up heart rate ranges for the range switch: by hour, by day, by week. */
export const RANGE_DEMO = {
  day: {
    buckets: HEART_RANGES_READ,
    axis: [formatClock(8 * 60), formatClock(17 * 60)] as const,
  },
  week: {
    buckets: WEEKDAYS.map((d, i) => ({
      min: 52 + (i % 3) * 2,
      max: 118 + ((i * 7) % 20),
      readout: `${d} · ${52 + (i % 3) * 2} to ${118 + ((i * 7) % 20)} bpm`,
    })),
    axis: ["Mon", "Sun"] as const,
  },
  month: {
    buckets: Array.from({ length: 30 }, (_, i) => ({
      min: 50 + (i % 5),
      max: 110 + ((i * 11) % 30),
      readout: `${i + 1} Nov · ${50 + (i % 5)} to ${110 + ((i * 11) % 30)} bpm`,
    })),
    axis: ["1 Nov", "30 Nov"] as const,
  },
};

/* --- Readouts for the tap-to-focus examples, all made up --------------------- */

export const STREAK_READ = STREAK.map((d) => {
  const day = new Date(`${d.date}T00:00:00Z`);
  const date = `${day.getUTCDate()} ${day.getUTCMonth() === 9 ? "Oct" : "Nov"}`;
  return { ...d, readout: `${date} · ${d.done ? "active" : "not active"}` };
});

const STAGE_WORD = { awake: "Awake", rem: "REM", core: "Core", deep: "Deep" } as const;

/** Minutes after 23:04 as a clock time. */
const nightClock = (minutes: number): string => formatClock(23 * 60 + 4 + minutes);

export const NIGHT_READ = NIGHT.map((s) => ({
  ...s,
  readout: `${STAGE_WORD[s.stage]} · ${nightClock(s.start)} to ${nightClock(s.end)}`,
}));

export const SLEEP_PARTS_READ = SLEEP_PARTS.map((p) => ({
  ...p,
  readout: `${p.label} · ${p.value} of ${p.max}`,
}));

const radarRead = <T extends { label: string; value: number | null; display: string }>(
  axes: readonly T[],
) =>
  axes.map((a) => ({
    ...a,
    readout: a.value === null ? `${a.label} · not in yet` : `${a.label} · ${a.display}`,
  }));

export const RADAR_SLEEP_READ = radarRead(RADAR_SLEEP);
export const RADAR_HEART_READ = radarRead(RADAR_HEART);
export const RADAR_READINESS_READ = radarRead(RADAR_READINESS);

/* --- Research figure options, made up except where marked ------------------- */

/** Made-up correctness by specialist, grouped by model. */
export const SPECIALISTS_BY_MODEL = [
  { label: "General", estimate: 0.71, low: 0.62, high: 0.79, series: "qwen3:8b" },
  { label: "General", estimate: 0.68, low: 0.58, high: 0.76, series: "qwen3:4b" },
  { label: "Heart rhythm", estimate: 0.83, low: 0.75, high: 0.89, series: "qwen3:8b" },
  { label: "Heart rhythm", estimate: 0.8, low: 0.71, high: 0.87, series: "qwen3:4b" },
  { label: "Brain", estimate: 0.64, low: 0.54, high: 0.73, series: "qwen3:8b" },
  { label: "Brain", estimate: 0.59, low: 0.49, high: 0.68, series: "qwen3:4b" },
].map((e) => ({ ...e, label: `${e.label} · ${e.series.replace("qwen3:", "")}` }));

/** P3's published ratios (docs/research): wide intervals near 1 read better on a log axis. */
export const P3_RATIOS = [
  { label: "Within person", estimate: 3.09, low: 2.07, high: 4.63 },
  { label: "Made-up wide", estimate: 1.6, low: 1.0, high: 7.2 },
  { label: "Made-up near 1", estimate: 1.12, low: 0.9, high: 1.4 },
];

/** P3's rule change (docs/research): observed against the expected value on its row. */
export const P3_RULE_CHANGE = [
  { label: "Before the change", estimate: 1.91 },
  { label: "After the change", estimate: 3.95, expected: 3.93 },
];

/**
 * The heart radar on each measure's own made-up personal range, so today and
 * the usual separate; resting and sleeping inverted.
 */
export const RADAR_HEART_SCALED = [
  {
    label: "Resting",
    value: 58,
    display: "58 bpm",
    reference: 61,
    min: 50,
    max: 66,
    inverted: true,
  },
  {
    label: "Sleeping",
    value: 52,
    display: "52 bpm",
    reference: 54,
    min: 46,
    max: 62,
    inverted: true,
  },
  { label: "Walking", value: 96, display: "96 bpm", reference: 92, min: 80, max: 110 },
  {
    label: "Workout",
    value: 138,
    display: "138 bpm",
    reference: 131,
    min: 115,
    max: 150,
  },
  { label: "HRV", value: 47, display: "47 ms", reference: 42, min: 30, max: 60 },
];
