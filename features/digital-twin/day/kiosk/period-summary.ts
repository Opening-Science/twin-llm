import { formatDate, formatNumber } from "@/infrastructure/format-measure";
import { type GlucoseProfile } from "@/packages/query-tools/day-beats";
import { type GlucosePeriod } from "@/packages/query-tools/day-period";
import { isToolRefusal, type ToolRefusal } from "@/packages/query-tools/refusals";
import { type WearableTrendResult } from "@/packages/query-tools/wearable-analytics";

/**
 * The week or month card's lines, written from a `show_my_period`-shaped
 * result. Pure: values are rounded for reading here, on the server, and the
 * screen draws the lines as given. Each line says what was read, never what
 * it means for a person.
 */

export type PeriodSummary = Readonly<{
  period: "week" | "month";
  start: string;
  end: string;
  title: string;
  lines: readonly Readonly<{ label: string; text: string }>[];
  notes: readonly string[];
}>;

export type PeriodSource = Readonly<{
  period: "week" | "month";
  start: string;
  end: string;
  profile: GlucoseProfile;
  glucose: GlucosePeriod;
  resting_hr: WearableTrendResult | ToolRefusal;
  hrv: WearableTrendResult | ToolRefusal;
  /** Null when the period has no sensor reading; then the card has no sensor line. */
  sensor_glucose?: GlucosePeriod | ToolRefusal | null;
  sensor_lag?: string | null;
}>;

const percent = (share: number): string => `${formatNumber(share * 100, 0)}%`;

const rangeText = (glucose: GlucosePeriod): string =>
  glucose.range.low === null
    ? `up to ${glucose.range.high} ${glucose.range.unit}`
    : `${glucose.range.low}–${glucose.range.high} ${glucose.range.unit}`;

const glucoseText = (glucose: GlucosePeriod, name = "blood glucose"): string => {
  if (glucose.n === 0 || glucose.average_mg_dl === null) {
    return `No ${name} readings in this period.`;
  }
  const readings = `${glucose.n} ${glucose.n === 1 ? "reading" : "readings"}`;
  const days = `${glucose.days} ${glucose.days === 1 ? "day" : "days"}`;
  const head = `Average ${formatNumber(glucose.average_mg_dl, 0)} mg/dL from ${readings} on ${days}.`;
  const share = glucose.share_of_readings;
  if (share === null) return head;
  const parts = [
    `${percent(share.within)} within`,
    `${percent(share.above)} above`,
    ...(share.below === null ? [] : [`${percent(share.below)} below`]),
  ];
  return `${head} ${parts.join(", ")} the range (${rangeText(glucose)}), as a share of readings, not of time.`;
};

const REFUSED: Readonly<Record<string, string>> = {
  NO_ROWS: "No readings in this period.",
  WINDOW_TOO_SHORT: "Fewer than 7 days of readings, so no trend.",
  MIXED_UNITS: "Readings in more than one unit; nothing is converted.",
  ROW_CAP_EXCEEDED: "Too many readings in this period to summarise.",
};

/** The fitted line over the period, in words: up, down or level, never better or worse. */
const slopeText = (perWeek: number, unit: string): string => {
  const size = formatNumber(Math.abs(perWeek), 1);
  if (size === formatNumber(0, 1)) return "Over the period, level.";
  return `Over the period, ${perWeek > 0 ? "up" : "down"} about ${size} ${unit} a week.`;
};

const trendText = (
  result: WearableTrendResult | ToolRefusal,
  unit: string,
  decimals: number,
): string => {
  if (isToolRefusal(result)) return REFUSED[result.code] ?? "No trend for this period.";
  const row = result.sources.find((one) => one.n > 0);
  if (!row) return REFUSED.NO_ROWS!;
  const recent = row.recent.median;
  const baseline = row.baseline.median;
  const medians =
    recent === null || baseline === null
      ? null
      : `Median ${formatNumber(recent, decimals)} ${unit} in the last 7 days, ${formatNumber(baseline, decimals)} ${unit} in the 28 days before.`;
  const slope = row.slope_per_week === null ? null : slopeText(row.slope_per_week, unit);
  return [medians, slope].filter((part) => part !== null).join(" ") || REFUSED.NO_ROWS!;
};

const title = (period: "week" | "month", start: string, end: string): string =>
  `${period === "week" ? "Week" : "30 days"}, ${formatDate(start)} to ${formatDate(end)}`;

export const periodSummary = (source: PeriodSource): PeriodSummary => ({
  period: source.period,
  start: source.start,
  end: source.end,
  title: title(source.period, source.start, source.end),
  lines: [
    { label: "Blood glucose", text: glucoseText(source.glucose) },
    ...(source.sensor_glucose
      ? [
          {
            label: "Sensor glucose",
            text: isToolRefusal(source.sensor_glucose)
              ? (REFUSED[source.sensor_glucose.code] ??
                "No sensor summary for this period.")
              : glucoseText(source.sensor_glucose, "sensor glucose"),
          },
        ]
      : []),
    { label: "Resting heart rate", text: trendText(source.resting_hr, "/min", 0) },
    { label: "Heart rate variability", text: trendText(source.hrv, "ms", 0) },
    {
      label: "Recovery after workouts",
      text: "Not recorded: no workout times are stored.",
    },
  ],
  notes: [
    `Glucose range: ${source.profile === "with_diabetes" ? "with diabetes" : "without diabetes"}, placeholder thresholds. Times are UTC.`,
    ...(source.sensor_lag ? [source.sensor_lag] : []),
  ],
});
