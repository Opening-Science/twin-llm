/** Markdown report and summary of a resolution study run (#290). Pure. */
import { fixed, withCi } from "../report";
import { FEATURES, type FeatureId } from "./aggregate";
import {
  DAY_FEATURES,
  type DailyEffect,
  type DayAuroc,
  HOUR_BINS,
  HOUR_FEATURES,
  type HourAuroc,
  type StudyOptions,
} from "./study";

export type DatabaseNote = Readonly<{
  id: string;
  name: string;
  records: number;
  hours: number;
  sha256SumsFile: string | null;
}>;

export type ResolutionSummary = Readonly<{
  title: string;
  note: string;
  version: number;
  gitSha: string;
  options: Omit<StudyOptions, "noise"> & Readonly<{ noise: readonly string[] }>;
  counts: Readonly<{ days: number; simulatedHours: number }>;
  databases: readonly DatabaseNote[];
  dayAurocs: readonly DayAuroc[];
  hourAurocs: readonly HourAuroc[];
  dailyEffects: readonly DailyEffect[];
}>;

const table = (
  header: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
): string =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

const featureLabel = (id: FeatureId, unit: "day" | "hour"): string => {
  const feature = FEATURES.find((each) => each.id === id);
  const level =
    feature?.level === "unit" ? (unit === "day" ? "daily" : "hourly") : feature?.level;
  const label =
    id === "unit.nrmssd"
      ? `nRMSSD of all beats in the ${unit}`
      : id === "unit.heart_rate"
        ? `Mean heart rate of the ${unit}`
        : (feature?.label ?? id);
  return `${level ?? ""}: ${label}`;
};

const percent = (value: number): string => `${Math.round(value * 100)} %`;

export const dayTable = (
  rows: readonly DayAuroc[],
  noise: string,
  variant: "absolute" | "change",
  burdens: readonly number[],
): string =>
  table(
    ["Level: score", ...burdens.map(percent), "All AF days"],
    DAY_FEATURES.map((feature) => [
      featureLabel(feature, "day"),
      ...[...burdens, "all" as const].map((burden) => {
        const cell = rows.find(
          (row) =>
            row.noise === noise &&
            row.variant === variant &&
            row.feature === feature &&
            row.burden === burden,
        );
        return cell === undefined ? "n/a" : withCi(cell.auroc);
      }),
    ]),
  );

export const hourTable = (
  rows: readonly HourAuroc[],
  source: string,
  noise: string,
): string =>
  table(
    ["Level: score", ...HOUR_BINS.map((bin) => `AF ${bin.id}`)],
    HOUR_FEATURES.map((feature) => [
      featureLabel(feature, "hour"),
      ...HOUR_BINS.map((bin) => {
        const cell = rows.find(
          (row) =>
            row.source === source &&
            row.noise === noise &&
            row.feature === feature &&
            row.bin === bin.id,
        );
        return cell === undefined ? "n/a" : withCi(cell.auroc);
      }),
    ]),
  );

const hourCounts = (rows: readonly HourAuroc[], source: string, noise: string): string =>
  HOUR_BINS.map((bin) => {
    const cell = rows.find(
      (row) =>
        row.source === source &&
        row.noise === noise &&
        row.feature === "unit.heart_rate" &&
        row.bin === bin.id,
    );
    return `${bin.id}: ${cell?.positives ?? 0}`;
  }).join(", ");

export const effectsTable = (rows: readonly DailyEffect[], noise: string): string =>
  table(
    [
      "Day",
      "Days",
      "AF share (median)",
      "Daily HR change, /min",
      "v3 assumes",
      "Resting HR change, /min",
      "v3 assumes",
      "Night RMSSD ratio",
      "v3 assumes",
    ],
    rows
      .filter((row) => row.noise === noise)
      .map((row) => [
        row.burden === 0 ? "sinus" : `AF ${percent(row.burden)}`,
        String(row.days),
        fixed(row.afShare, 3),
        fixed(row.heartRateChange, 1),
        row.burden === 0 ? "0" : "+10 to +20",
        fixed(row.restingHeartRateChange, 1),
        "0",
        fixed(row.hrvRmssdRatio, 2),
        row.burden === 0 ? "1" : fixed(1 + 2 * row.burden, 2),
      ]),
  );

export const markdownReport = (
  summary: ResolutionSummary,
  generatedAt: string,
): string => {
  const { options } = summary;
  const parts = [
    `# ${summary.title}`,
    "",
    `${summary.note}`,
    "",
    `Generated ${generatedAt}, git \`${summary.gitSha}\`, study version ${summary.version}. ${options.subjects} simulated subjects, ${summary.counts.days} days per noise level; ${options.resamples} bootstrap resamples over subjects or records, seed ${options.bootstrapSeed}.`,
    "",
    "## AF day against sinus day",
    "",
    "AUROC [95 % CI]; AF days of each burden (share of the day) against the subjects' evaluation sinus days.",
  ];
  for (const noise of options.noise) {
    for (const variant of ["change", "absolute"] as const) {
      parts.push(
        "",
        `### Noise ${noise}, ${variant === "change" ? "change from own baseline" : "absolute value"}`,
        "",
        dayTable(summary.dayAurocs, noise, variant, options.burdens),
      );
    }
  }
  parts.push("", "## Daily summaries on AF days against v3's assumptions", "");
  for (const noise of options.noise) {
    parts.push(`Noise ${noise}:`, "", effectsTable(summary.dailyEffects, noise), "");
  }
  parts.push("## AF hour against AF-free hour", "");
  const sources = [
    ...options.noise.map((noise) => ({
      source: "sim",
      noise,
      title: `Simulated, noise ${noise}`,
    })),
    ...summary.databases.map((db) => ({ source: db.id, noise: "none", title: db.name })),
  ];
  for (const each of sources) {
    parts.push(
      `### ${each.title}`,
      "",
      `AF hours per bin: ${hourCounts(summary.hourAurocs, each.source, each.noise)}.`,
      "",
      hourTable(summary.hourAurocs, each.source, each.noise),
      "",
    );
  }
  return `${parts.join("\n").trimEnd()}\n`;
};
