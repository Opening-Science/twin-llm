import { formatDate, formatNumber } from "@/infrastructure/format-measure";

import { type SubjectOverview, type SubjectSeries } from "./subject-series";

/**
 * The one-sentence summary at the top of a subject page, from counts only.
 * It describes the record, not the person: no value is called high or low.
 */

const plural = (n: number, one: string, many: string) =>
  `${formatNumber(n, 0)} ${n === 1 ? one : many}`;

const listOf = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export const subjectStory = (
  overview: SubjectOverview,
  series: readonly SubjectSeries[],
  nonNumeric: number,
): string => {
  const text = `, and ${plural(nonNumeric, "text observation", "text observations")}`;
  if (overview.observations === 0) {
    return `This synthetic subject has no numeric observations${nonNumeric > 0 ? text : ""}.`;
  }
  const top = [...new Set(series.map((s) => s.display))].slice(0, 3);
  return (
    `This synthetic subject has ${plural(overview.observations, "numeric observation", "numeric observations")} ` +
    `of ${plural(overview.codes, "LOINC code", "LOINC codes")}, from ${formatDate(overview.firstDay)} ` +
    `to ${formatDate(overview.lastDay)}${nonNumeric > 0 ? text : ""}. ` +
    `Most readings: ${listOf(top)}.`
  );
};
