import type { GbdRow } from "@/packages/gbd-mcp/normalize";
import type { GbdEstimateResult } from "@/packages/query-tools/gbd-estimate";

/**
 * `gbd_estimate` rows in the shape the explainability panel lists GBD rows
 * (`formatGbdRow`). A risk factor's estimate names the risk and the cause.
 * Pure.
 */
export const gbdPanelRows = (result: GbdEstimateResult): readonly GbdRow[] => {
  const subject = [result.risk, result.cause].filter((part) => part !== null).join(" · ");
  return result.rows.map((row) => ({
    measure: result.measure,
    cause: subject,
    location: row.location,
    year: String(row.year),
    sex: result.sex,
    age: result.age,
    value: row.value,
    lower: row.lower,
    upper: row.upper,
    unit: result.metric,
    source: result.source,
  }));
};

const panelKey = (row: GbdRow): string =>
  [row.measure, row.cause, row.location, row.year, row.sex, row.age, row.unit].join("|");

/**
 * The rows not yet in `seen`, which it then holds too. A profile (#403) reads
 * one estimate in more than one call (a place's HALE for its own section and
 * for the map); the panel lists it once.
 */
export const unseenPanelRows = (
  seen: Set<string>,
  rows: readonly GbdRow[],
): readonly GbdRow[] =>
  rows.filter((row) => {
    const key = panelKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
