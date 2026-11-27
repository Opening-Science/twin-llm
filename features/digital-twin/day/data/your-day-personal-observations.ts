import { type Bundle, type Observation } from "fhir/r4";

import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";
import {
  LOINC_SYSTEM,
  type ImportedObservationRecord,
} from "@/packages/query-tools/imported-ports";
import { inLocalDay, localDayBounds } from "@/packages/query-tools/replay/local-time";

import { YOUR_DAY_COPY } from "../../twin-page-copy";
import { isDailyRecord, isOuraScore, VENDOR_SYSTEMS } from "../charts/vendor-measures";
import { type DayObservation } from "../charts/your-day-observations";

export type ImportedDayObservation = ImportedObservationRecord &
  Readonly<{ codeSystem: string | null }>;

type Coding = Readonly<{ system?: string; code?: string; display?: string }>;

const identityCoding = (codings: readonly Coding[] = []) =>
  codings.find(({ system }) => system && VENDOR_SYSTEMS.has(system)) ??
  codings.find(({ system }) => system === LOINC_SYSTEM) ??
  codings[0];

export function importedDayObservations(
  rows: readonly ImportedDayObservation[],
  day: string,
  zone: string,
): DayObservation[] {
  const bounds = localDayBounds(day, zone);
  // The browser gets opaque keys scoped to this response, never database ids:
  // `id` is the row's position in this read, and `sourceId` numbers each
  // dataset in the order it first appears, which keeps two imports apart.
  const datasetKey = new Map(
    [...new Set(rows.map(({ datasetId }) => datasetId))].map((id, index) => [
      id,
      `import-set:${index}`,
    ]),
  );
  return rows.flatMap((row, index) => {
    if (!Number.isFinite(row.value)) return [];
    const at = row.effectiveAt.toISOString();
    const daily = row.effectivePrecision === "day";
    if (
      daily
        ? at.slice(0, 10) !== day
        : row.effectivePrecision !== "instant" || !inLocalDay(row.effectiveAt, bounds)
    )
      return [];
    return [
      {
        id: `import-row:${index}`,
        codeSystem: row.codeSystem,
        code: row.code,
        unit: row.unit,
        value: row.value,
        day,
        at,
        sourceId: datasetKey.get(row.datasetId) ?? "import",
        source: YOUR_DAY_COPY.personal.importedSource,
        provenance: "imported",
        label: row.display,
        timing: daily ? "day" : "observation",
        interval_min: 0,
      },
    ];
  });
}

export function connectedDayObservations(
  bundle: unknown,
  source: string,
  day: string,
  zone: string,
): DayObservation[] {
  if (
    !bundle ||
    typeof bundle !== "object" ||
    Reflect.get(bundle, "resourceType") !== "Bundle"
  )
    return [];
  const bounds = localDayBounds(day, zone);
  return ((bundle as Bundle).entry ?? []).flatMap((entry, index) => {
    if (entry.resource?.resourceType !== "Observation") return [];
    const resource = entry.resource as Observation;
    const coding =
      resource.code.coding?.find(({ system }) => system === LOINC_SYSTEM) ??
      resource.code.coding?.[0];
    const from = Date.parse(resource.effectivePeriod?.start ?? "");
    const to = Date.parse(resource.effectivePeriod?.end ?? "");
    const hasPeriod = Number.isFinite(from) && Number.isFinite(to) && to > from;
    const duration = hasPeriod ? (to - from) / 60_000 : 0;
    const interval =
      hasPeriod &&
      duration < 23 * 60 &&
      coding?.system === LOINC_SYSTEM &&
      coding.code === MEASURES.steps.code;
    const time = resource.effectiveDateTime;
    const dateOnly = time !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(time);
    const identity = identityCoding(resource.code.coding);
    const localDay = dateOnly
      ? time
      : !hasPeriod &&
          time &&
          /^\d{4}-\d{2}-\d{2}T/.test(time) &&
          isDailyRecord(identity?.system, identity?.code)
        ? time.slice(0, 10)
        : null;
    const instant = new Date(
      hasPeriod
        ? interval
          ? from
          : to - 1
        : time && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(time)
          ? Date.parse(time)
          : Number.NaN,
    );
    const belongs = interval
      ? from < bounds.end.getTime() && to > bounds.start.getTime()
      : localDay
        ? localDay === day
        : inLocalDay(instant, bounds);
    if (!belongs) return [];
    const at = localDay ? `${localDay}T00:00:00.000Z` : instant.toISOString();
    return [resource, ...(resource.component ?? [])].flatMap(
      (record, part): DayObservation[] => {
        const { valueQuantity, code } = record;
        const value = valueQuantity?.value;
        if (value === undefined || !Number.isFinite(value)) return [];
        const term = identityCoding(code.coding);
        const label = code.text || term?.display || term?.code;
        if (!label) return [];
        const unit = valueQuantity?.code || valueQuantity?.unit || "";
        return [
          {
            id: `${source}:${index}:${part}`,
            sourceId: `wearable:${source}`,
            source,
            provenance: isOuraScore(term?.system, unit) ? "derived" : "measured",
            codeSystem: term?.system ?? null,
            code: term?.code ?? null,
            label,
            unit,
            day,
            at,
            value,
            timing:
              interval && part === 0
                ? "interval"
                : hasPeriod || localDay
                  ? "day"
                  : "observation",
            interval_min: interval && part === 0 ? duration : 0,
          },
        ];
      },
    );
  });
}
