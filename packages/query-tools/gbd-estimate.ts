import "server-only";

import {
  GBD_ESTIMATE_TOOL,
  GBD_LOCAL_ATTRIBUTION,
  GBD_LOCAL_SOURCE,
  GBD_MEASURE_IDS,
  GBD_METRIC_IDS,
  GBD_METRIC_UNITS,
  GBD_SEX_IDS,
} from "@/packages/gbd-local/constants";
import {
  findImportedName,
  gbdAgeId,
  type GbdNamed,
  importedChildIds,
  importedSdiIds,
  missingPairs,
  resolveGbdPlace,
  sortGbdEstimates,
} from "@/packages/gbd-local/estimate-rows";
import { gbdLocationById } from "@/packages/gbd-local/locations";
import type { AppendInput } from "@/packages/audit/append";

import type { GbdEstimateInput } from "./gbd-estimate-schema";
import {
  GBD_NO_SDI,
  GBD_NOT_IMPORTED,
  GBD_ROW_CAP,
  GBD_TOO_MANY_ROWS,
  gbdAmbiguousLocation,
  gbdNoEstimate,
  type GbdRefusal,
  gbdUnknownCause,
  gbdUnknownLocation,
  gbdUnknownRisk,
} from "./gbd-refusals";
import type { SessionScope } from "./scope";
import { audited } from "./tool-core";

/**
 * `gbd_estimate` (#387): one capped read of the GBD 2023 results imported on
 * this machine. Population estimates only: it reads no subject and no
 * personal data and sends nothing anywhere, so it runs in synthetic and
 * personal mode alike and its audit row has no subject_ref.
 */

export type GbdCatalog = Readonly<{
  locations: readonly GbdNamed[];
  causes: readonly GbdNamed[];
  risks: readonly GbdNamed[];
  /** GBD age ids with at least one imported estimate. */
  ages: readonly number[];
}>;

export type GbdEstimateQuery = Readonly<{
  measureId: number;
  metricId: number;
  sexId: number;
  ageId: number;
  years: readonly number[];
  locationIds: readonly number[];
  /** null: rows without a cause. */
  causeId: number | null;
  /** null: rows without a risk factor. */
  reiId: number | null;
  take: number;
}>;

export type GbdStoredEstimate = Readonly<{
  locationId: number;
  locationName: string;
  year: number;
  val: number;
  upper: number | null;
  lower: number | null;
}>;

export type GbdEstimatePorts = Readonly<{
  /** Imported names of the locations, causes and risk factors. */
  catalog: () => Promise<GbdCatalog>;
  findEstimates: (query: GbdEstimateQuery) => Promise<readonly GbdStoredEstimate[]>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

export type GbdEstimateRow = Readonly<{
  location: string;
  location_id: number;
  iso3: string | null;
  iso3166_2: string | null;
  year: number;
  value: number;
  lower: number | null;
  upper: number | null;
}>;

export type GbdEstimateResult = Readonly<{
  attribution: string;
  source: string;
  measure: GbdEstimateInput["measure"];
  metric: GbdEstimateInput["metric"];
  unit: string;
  sex: GbdEstimateInput["sex"];
  age: GbdEstimateInput["age"];
  cause: string | null;
  risk: string | null;
  n: number;
  rows: readonly GbdEstimateRow[];
  /** Asked location-year pairs the import holds no estimate for. */
  not_imported: readonly Readonly<{ location: string; year: number }>[];
}>;

/** Rows the model gets whole; a longer result reaches it summarised. */
const MODEL_ROWS = 30;
const MODEL_TOP = 10;
const MODEL_BOTTOM = 5;

export type GbdModelResult = GbdEstimateResult & Readonly<{ rows_shown?: string }>;

/**
 * What the model reads of a `gbd_estimate` result. Up to 30 rows it is the
 * result itself. A longer one (every country for a world map, #394) would
 * not fit the chat context, so the model gets `n`, the 10 highest and the 5
 * lowest values and a note; the map, the panel and the number check keep
 * every row. Pure.
 */
export const gbdModelOutput = (
  result: GbdEstimateResult | GbdRefusal,
): GbdModelResult | GbdRefusal => {
  if (!("rows" in result) || result.rows.length <= MODEL_ROWS) return result;
  const byValue = [...result.rows].sort((a, b) => b.value - a.value);
  const shown = [...byValue.slice(0, MODEL_TOP), ...byValue.slice(-MODEL_BOTTOM)];
  return {
    ...result,
    rows: shown,
    rows_shown: `${shown.length} of ${result.rows.length} rows: the ${MODEL_TOP} highest and ${MODEL_BOTTOM} lowest values; the map and the panel show all`,
  };
};

type Places =
  | Readonly<{ ok: true; ids: readonly number[] }>
  | Readonly<{ ok: false; refusal: GbdRefusal }>;

const resolvePlaces = (
  input: GbdEstimateInput,
  imported: readonly GbdNamed[],
): Places => {
  if (input.sdi === true) {
    const ids = importedSdiIds(imported);
    return ids.length === 0 ? { ok: false, refusal: GBD_NO_SDI } : { ok: true, ids };
  }
  const queries =
    input.children_of === undefined ? (input.locations ?? []) : [input.children_of];
  const ids: number[] = [];
  for (const query of queries) {
    const resolved = resolveGbdPlace(query, imported);
    if (resolved.kind === "unknown")
      return { ok: false, refusal: gbdUnknownLocation(query) };
    if (resolved.kind === "ambiguous") {
      return { ok: false, refusal: gbdAmbiguousLocation(query, resolved.options) };
    }
    ids.push(resolved.id);
  }
  if (input.children_of !== undefined) {
    const children = importedChildIds(ids[0]!, imported);
    return children.length === 0
      ? {
          ok: false,
          refusal: gbdNoEstimate(`any location inside ${input.children_of}`),
        }
      : { ok: true, ids: children };
  }
  return { ok: true, ids: [...new Set(ids)] };
};

const nameOf = (id: number, imported: readonly GbdNamed[]): string =>
  imported.find((entry) => entry.id === id)?.name ??
  gbdLocationById(id)?.name ??
  `id ${id}`;

const rowOf = (estimate: GbdStoredEstimate): GbdEstimateRow => {
  const location = gbdLocationById(estimate.locationId);
  return {
    location: estimate.locationName,
    location_id: estimate.locationId,
    iso3: location?.iso3 ?? null,
    iso3166_2: location?.iso3166_2 ?? null,
    year: estimate.year,
    value: estimate.val,
    lower: estimate.lower,
    upper: estimate.upper,
  };
};

const work = async (
  input: GbdEstimateInput,
  ports: GbdEstimatePorts,
): Promise<GbdEstimateResult | GbdRefusal> => {
  const catalog = await ports.catalog();
  if (catalog.locations.length === 0) return GBD_NOT_IMPORTED;
  const risk =
    input.risk === undefined ? null : findImportedName(input.risk, catalog.risks);
  if (input.risk !== undefined && risk === null) {
    return gbdUnknownRisk(
      input.risk,
      catalog.risks.map((entry) => entry.name),
    );
  }
  // A risk factor alone is its burden from all causes, as the Results Tool shows it.
  const causeQuery = input.cause ?? (risk === null ? null : "All causes");
  const cause = causeQuery === null ? null : findImportedName(causeQuery, catalog.causes);
  if (input.cause !== undefined && cause === null) {
    return gbdUnknownCause(
      input.cause,
      catalog.causes.map((entry) => entry.name),
    );
  }
  const places = resolvePlaces(input, catalog.locations);
  if (!places.ok) return places.refusal;
  const ageId = gbdAgeId(input.age, catalog.ages);
  const subject = [cause?.name, risk?.name].filter(Boolean).join(" and ");
  const asked = `${input.measure} (${input.metric}), ${input.sex}, ${input.age}${subject === "" ? "" : `, ${subject}`}`;
  if (ageId === null) return gbdNoEstimate(`${asked}: no such age group is imported`);
  const years = [...new Set(input.years)].sort((a, b) => a - b);
  const found = await ports.findEstimates({
    measureId: GBD_MEASURE_IDS[input.measure],
    metricId: GBD_METRIC_IDS[input.metric],
    sexId: GBD_SEX_IDS[input.sex],
    ageId,
    years,
    locationIds: places.ids,
    causeId: cause?.id ?? null,
    reiId: risk?.id ?? null,
    take: GBD_ROW_CAP + 1,
  });
  if (found.length > GBD_ROW_CAP) return GBD_TOO_MANY_ROWS;
  if (found.length === 0) {
    return gbdNoEstimate(`${asked} in these places and years`);
  }
  const rows = sortGbdEstimates(found.map(rowOf));
  return {
    attribution: GBD_LOCAL_ATTRIBUTION,
    source: GBD_LOCAL_SOURCE,
    measure: input.measure,
    metric: input.metric,
    unit: GBD_METRIC_UNITS[input.metric],
    sex: input.sex,
    age: input.age,
    cause: cause?.name ?? null,
    risk: risk?.name ?? null,
    n: rows.length,
    rows,
    not_imported: missingPairs(places.ids, years, found).map((pair) => ({
      location: nameOf(pair.locationId, catalog.locations),
      year: pair.year,
    })),
  };
};

export const runGbdEstimate = (
  scope: SessionScope,
  input: GbdEstimateInput,
  ports: GbdEstimatePorts,
): Promise<GbdEstimateResult | GbdRefusal> =>
  audited<GbdEstimateResult | GbdRefusal>(
    scope,
    GBD_ESTIMATE_TOOL,
    input,
    null,
    () => work(input, ports),
    (result) => ("n" in result ? result.n : 0),
    ports,
  );
