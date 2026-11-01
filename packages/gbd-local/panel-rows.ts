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
