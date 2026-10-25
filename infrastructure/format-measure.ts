/**
 * The one place that turns numbers, units, dates and metric keys into text.
 *
 * Before this, the same HRV read 43.886 ms in a table, 43.9 in a tooltip and
 * 44 on a ring, depending on which file happened to render it. Pure, with no
 * `server-only`, so client screens and server code share the same rules.
 *
 * Decisions, recorded here and in docs/coding-standards.md:
 * - Locale is fixed to `en-GB`: plain `,` thousands and `.` decimals, dates
 *   like `16 Oct 2026`. `en-CH` groups with `’`, which reads oddly in English
 *   copy and varies across ICU builds.
 * - Angles render with `°` and no space (`12.3°`). The `deg` unit token that
 *   BodyLoop summaries carry stays as data; only the rendering changes.
 * - Rounding is half away from zero on the decimal value. `Intl` alone rounds
 *   the binary double, so 0.15 would print "0.1"; shifting the exponent in the
 *   string first gives the "0.2" a reader expects.
 * - Anything that is not a finite number renders as `—`.
 */

export const DISPLAY_LOCALE = "en-GB";
export const EMPTY_VALUE = "—";

type MeasureSpec = Readonly<{ decimals: number; unit: string; spaced: boolean }>;

export const MEASURES = {
  hrv: { decimals: 0, unit: "ms", spaced: true },
  heartRate: { decimals: 0, unit: "bpm", spaced: true },
  spo2: { decimals: 1, unit: "%", spaced: false },
  percent: { decimals: 0, unit: "%", spaced: false },
  score: { decimals: 0, unit: "", spaced: false },
  sleepMinutes: { decimals: 0, unit: "min", spaced: true },
  steps: { decimals: 0, unit: "", spaced: false },
  kcal: { decimals: 0, unit: "kcal", spaced: true },
  strain: { decimals: 1, unit: "", spaced: false },
  lengthCm: { decimals: 1, unit: "cm", spaced: true },
  angle: { decimals: 1, unit: "°", spaced: false },
  massKg: { decimals: 1, unit: "kg", spaced: true },
  bmi: { decimals: 1, unit: "", spaced: false },
  tokensPerSecond: { decimals: 1, unit: "tok/s", spaced: true },
  ms: { decimals: 0, unit: "ms", spaced: true },
  costUsd: { decimals: 4, unit: "$", spaced: false },
} as const satisfies Record<string, MeasureSpec>;

export type MeasureKind = keyof typeof MEASURES;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Numeric rounding with the same rule the display uses. Never returns -0. */
export const roundTo = (value: number, decimals: number): number => {
  const abs = Math.abs(value);
  // Past 1e21 a double has no fraction digits left to round.
  if (abs >= 1e21) return value;
  const text = String(abs);
  const rounded = text.includes("e")
    ? Math.round(abs * 10 ** decimals) / 10 ** decimals
    : Number(`${Math.round(Number(`${text}e${decimals}`))}e-${decimals}`);
  if (rounded === 0) return 0;
  return value < 0 ? -rounded : rounded;
};

const numberFormats = new Map<string, Intl.NumberFormat>();

const numberFormat = (min: number, max: number): Intl.NumberFormat => {
  const cacheKey = `${min}:${max}`;
  const cached = numberFormats.get(cacheKey);
  if (cached) return cached;
  const created = new Intl.NumberFormat(DISPLAY_LOCALE, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });
  numberFormats.set(cacheKey, created);
  return created;
};

/** A number with exactly `decimals` fraction digits, grouped, or `—`. */
export const formatNumber = (
  value: number | null | undefined,
  decimals: number,
): string =>
  isFiniteNumber(value)
    ? numberFormat(decimals, decimals).format(roundTo(value, decimals))
    : EMPTY_VALUE;

/** Up to one decimal, trailing zero dropped: for values with no known kind. */
const formatLoose = (value: number): string =>
  numberFormat(0, 1).format(roundTo(value, 1));

const formatSleepMinutes = (value: number): string => {
  const total = roundTo(Math.abs(value), 0);
  const sign = value < 0 && total > 0 ? "-" : "";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${sign}${minutes} min`;
  if (minutes === 0) return `${sign}${formatNumber(hours, 0)} h`;
  return `${sign}${formatNumber(hours, 0)} h ${minutes} min`;
};

/** The number a measure kind shows, without its unit (rings, axis ticks). */
export const formatMeasureNumber = (
  kind: MeasureKind,
  value: number | null | undefined,
): string => formatNumber(value, MEASURES[kind].decimals);

/**
 * Like `formatMeasureNumber`, but five digits and more shrink to thousands
 * ("11.2K") and millions ("1.3M"), for a slot as narrow as a score ring.
 */
export const formatMeasureCompact = (
  kind: MeasureKind,
  value: number | null | undefined,
): string => {
  if (!isFiniteNumber(value) || Math.abs(roundTo(value, 0)) < 10_000)
    return formatMeasureNumber(kind, value);
  // 999,950 would round to "1,000K"; that is a million.
  if (Math.abs(roundTo(value / 1000, 1)) < 1000) return `${formatLoose(value / 1000)}K`;
  return `${formatLoose(value / 1_000_000)}M`;
};

export const formatMeasure = (
  kind: MeasureKind,
  value: number | null | undefined,
): string => {
  if (!isFiniteNumber(value)) return EMPTY_VALUE;
  if (kind === "sleepMinutes") return formatSleepMinutes(value);
  const spec: MeasureSpec = MEASURES[kind];
  if (kind === "costUsd") {
    const amount = formatNumber(Math.abs(value), spec.decimals);
    return `${roundTo(value, spec.decimals) < 0 ? "-" : ""}$${amount}`;
  }
  const number = formatNumber(value, spec.decimals);
  if (!spec.unit) return number;
  return spec.spaced ? `${number} ${spec.unit}` : `${number}${spec.unit}`;
};

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Today (or `date`) as YYYY-MM-DD in the viewer's time zone, not UTC. */
export const isoLocalDate = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const dateFormats = {
  long: new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }),
  short: new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }),
} as const;

/**
 * A calendar day as `16 Oct 2026` (or `16 Oct`). Takes YYYY-MM-DD, which is
 * how every metric date is stored, and reads it as that day in UTC so the
 * label never shifts with the viewer's time zone.
 */
export const formatDate = (
  isoDay: string | null | undefined,
  style: keyof typeof dateFormats = "long",
): string => {
  if (!isoDay || !ISO_DATE_ONLY.test(isoDay)) return EMPTY_VALUE;
  const [y, m, d] = isoDay.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  // Reject days that roll over (2026-02-31 would quietly become 3 Mar).
  if (date.getUTCMonth() !== m! - 1 || date.getUTCDate() !== d) return EMPTY_VALUE;
  return dateFormats[style].format(date);
};

const MS_PER_HOUR = 3_600_000;

/** `just now`, `5 h ago`, `3 d ago`. Future timestamps (clock skew) read "just now". */
export const formatRelative = (
  iso: string | null | undefined,
  now: number = Date.now(),
): string => {
  if (!iso) return EMPTY_VALUE;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return EMPTY_VALUE;
  const hours = Math.floor((now - then) / MS_PER_HOUR);
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
};

/** Google Health measure slugs as people read them. Summaries share this table. */
export const GOOGLE_MEASURE_LABELS: Readonly<Record<string, string>> = {
  steps: "Steps",
  distance: "Distance",
  "active-minutes": "Active minutes",
  "daily-resting-heart-rate": "Resting heart rate",
  "daily-heart-rate-variability": "Daily HRV",
  "daily-oxygen-saturation": "Daily SpO2",
  sleep: "Sleep",
  weight: "Weight",
  "heart-rate": "Heart rate",
  "oxygen-saturation": "SpO2",
};

const STEM_LABELS: Readonly<Record<string, string>> = {
  "sleep.score": "Sleep score",
  "sleep.hrv": "Average HRV during sleep",
  "sleep.hr": "Average heart rate during sleep",
  "sleep.duration": "Total sleep duration",
  "sleep.efficiency": "Sleep efficiency",
  "readiness.score": "Readiness score",
  "readiness.hrv_balance": "HRV balance contributor",
  "activity.score": "Activity score",
  "activity.steps": "Steps",
  "activity.active_calories": "Active calories",
  "whoop.recovery.score": "Whoop recovery score",
  "whoop.recovery.hrv": "Whoop HRV RMSSD",
  "whoop.recovery.rhr": "Whoop resting HR",
  "whoop.recovery.spo2": "Whoop SpO2",
  "whoop.cycle.strain": "Whoop day strain",
  "whoop.cycle.avg_hr": "Whoop cycle average HR",
  "whoop.sleep.performance": "Whoop sleep performance",
  "whoop.sleep.efficiency": "Whoop sleep efficiency",
  "whoop.sleep.consistency": "Whoop sleep consistency",
  "whoop.sleep.in_bed_min": "Whoop time in bed",
};

const STEM_KINDS: Readonly<Record<string, MeasureKind>> = {
  "sleep.score": "score",
  "sleep.hrv": "hrv",
  "sleep.hr": "heartRate",
  "sleep.duration": "sleepMinutes",
  "sleep.efficiency": "percent",
  "readiness.score": "score",
  "readiness.hrv_balance": "score",
  "activity.score": "score",
  "activity.steps": "steps",
  "activity.active_calories": "kcal",
  "whoop.recovery.score": "score",
  "whoop.recovery.hrv": "hrv",
  "whoop.recovery.rhr": "heartRate",
  "whoop.recovery.spo2": "spo2",
  "whoop.cycle.strain": "strain",
  "whoop.cycle.avg_hr": "heartRate",
  "whoop.sleep.performance": "percent",
  "whoop.sleep.efficiency": "percent",
  "whoop.sleep.consistency": "percent",
  "whoop.sleep.in_bed_min": "sleepMinutes",
  "google.steps": "steps",
  "google.heart-rate": "heartRate",
  "google.daily-resting-heart-rate": "heartRate",
  "google.daily-heart-rate-variability": "hrv",
  "google.oxygen-saturation": "spo2",
  "google.daily-oxygen-saturation": "spo2",
  "google.weight": "massKg",
};

/** Units that pin a kind when the key alone does not (BodyLoop rows, Google extras). */
const UNIT_KINDS: Readonly<Record<string, MeasureKind>> = {
  cm: "lengthCm",
  deg: "angle",
  "°": "angle",
  kg: "massKg",
  "kg/m2": "bmi",
  bpm: "heartRate",
  kcal: "kcal",
};

const DATE_SUFFIX_KEY = /\.\d{4}-\d{2}-\d{2}$/;
const DATE_SUFFIX_LABEL = /\s*\(\d{4}-\d{2}-\d{2}\)\s*$/;

/** Oura suffixes a period (`long_sleep`, `late_nap`) onto sleep keys. */
const MAIN_SLEEP_PERIODS = new Set(["long_sleep", "sleep", "rest"]);

const splitStem = (key: string): Readonly<{ stem: string; period: string | null }> => {
  const stem = key.replace(DATE_SUFFIX_KEY, "");
  const parts = stem.split(".");
  if (parts[0] === "sleep" && parts.length === 3) {
    return { stem: parts.slice(0, 2).join("."), period: parts[2]! };
  }
  return { stem, period: null };
};

/** A stored metric key without its date or sleep period: `sleep.hr.2026-10-01` → `sleep.hr`. */
export const metricStem = (key: string): string => splitStem(key).stem;

const VITRONIC_PREFIXES = {
  height: "BodyLoop height",
  distance: "BodyLoop distance",
  angle: "BodyLoop angle",
} as const;

const vitronicLabel = (rest: readonly string[], family: string): string | null => {
  if (rest.length === 0) return null;
  if (family in VITRONIC_PREFIXES) {
    return `${VITRONIC_PREFIXES[family as keyof typeof VITRONIC_PREFIXES]} ${rest.join(".")}`;
  }
  if (family === "circumference" && rest.length >= 2) {
    return `BodyLoop circumference ${rest.slice(0, -1).join(".")} ${rest.at(-1)}`;
  }
  if (family === "property") return `BodyLoop ${rest.join(".")}`;
  return null;
};

/**
 * A metric key as a label, with no date in it: the date is shown on its own.
 * Unknown keys fall back to the stored label with its `(YYYY-MM-DD)` removed.
 */
export const metricLabel = (key: string, fallback?: string): string => {
  const { stem, period } = splitStem(key);
  const known = STEM_LABELS[stem];
  if (known) {
    return period && !MAIN_SLEEP_PERIODS.has(period)
      ? `${known} (${period.replace(/_/g, " ")})`
      : known;
  }
  const [source, family, ...rest] = stem.split(".");
  if (source === "google" && family) {
    const google = GOOGLE_MEASURE_LABELS[family];
    if (google) return google;
  }
  if (source === "vitronic" && family) {
    const vitronic = vitronicLabel(rest, family);
    if (vitronic) return vitronic;
  }
  if (fallback) return fallback.replace(DATE_SUFFIX_LABEL, "");
  return stem;
};

/** The measure kind for a stored metric, from its key first and its unit second. */
export const measureKindFor = (key: string, unit?: string): MeasureKind | null => {
  // Callers often pass a prefix such as `whoop.cycle.strain.`.
  const { stem } = splitStem(key.replace(/\.$/, ""));
  if (!stem.startsWith("vitronic.")) {
    const byKey = STEM_KINDS[stem];
    if (byKey) return byKey;
  }
  return (unit && UNIT_KINDS[unit]) || null;
};

const normaliseUnit = (unit: string): string => (unit === "deg" ? "°" : unit);

/** The key's kind applies only when the stored unit is empty or is that kind's unit. */
const unitMatches = (kind: MeasureKind, unit: string): boolean =>
  unit === "" || normaliseUnit(unit) === MEASURES[kind].unit;

export type FormattableMetric = Readonly<{
  key: string;
  value: string | number;
  unit?: string;
  label?: string;
  date?: string;
}>;

/** A stored metric's value with its unit, at the precision its kind defines. */
export const formatMetricValue = (metric: FormattableMetric): string => {
  const unit = metric.unit ?? "";
  if (typeof metric.value === "string")
    return unit ? `${metric.value} ${unit}` : metric.value;
  const kind = measureKindFor(metric.key, unit);
  if (kind && unitMatches(kind, unit)) return formatMeasure(kind, metric.value);
  if (!isFiniteNumber(metric.value)) return EMPTY_VALUE;
  // A stored unit always wins over the key: google.weight in lb stays lb.
  const number = kind
    ? formatMeasureNumber(kind, metric.value)
    : formatLoose(metric.value);
  if (!unit) return number;
  return unit === "%" || unit === "°" ? `${number}${unit}` : `${number} ${unit}`;
};

/**
 * One line per metric for the model's context: the citation key, the label,
 * the ISO date (unambiguous for a model) and the displayed value.
 */
export const formatForPrompt = (metric: FormattableMetric): string =>
  `[${metric.key}] ${metricLabel(metric.key, metric.label)}${metric.date ? ` (${metric.date})` : ""}: ${formatMetricValue(metric)}`;
