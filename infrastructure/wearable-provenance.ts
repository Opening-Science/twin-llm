/**
 * Where a wearable number comes from, in plain words (#464): the source that
 * recorded it and its day, and, where the app picked one source over others,
 * the rule it used. Pure, so the chat's evidence chips and the Digital Twin's
 * vitals share it on server and client. It names a source by its product
 * name only: never a stored key, a vendor id or a subject id.
 *
 * Nothing here combines sources. Every value the app shows today was recorded
 * by one source; the open-twin aggregate (`open-twin-adapters/aggregate.ts`)
 * is not read on screen yet.
 */
import { formatDate } from "./format-measure";

export const WEARABLE_SOURCE_IDS = [
  "oura",
  "whoop",
  "google_health",
  "bodyloop",
] as const;

export type WearableSourceId = (typeof WEARABLE_SOURCE_IDS)[number];

export const WEARABLE_SOURCE_LABEL: Readonly<Record<WearableSourceId, string>> = {
  oura: "Oura",
  whoop: "WHOOP",
  google_health: "Google Health",
  bodyloop: "BodyLoop",
};

export const isWearableSourceId = (value: unknown): value is WearableSourceId =>
  typeof value === "string" && (WEARABLE_SOURCE_IDS as readonly string[]).includes(value);

/** Stored keys by vendor prefix; Oura's carry no prefix of their own. */
export const sourceOfMetricKey = (key: string): WearableSourceId =>
  key.startsWith("whoop.")
    ? "whoop"
    : key.startsWith("google.")
      ? "google_health"
      : key.startsWith("vitronic.")
        ? "bodyloop"
        : "oura";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day a reading belongs to: its own `date`, else the date its key
 * ends with. Null when neither is a real day (WHOOP writes "unknown").
 */
export const metricDay = (
  metric: Readonly<{ key: string; date?: string }>,
): string | null => {
  const day = metric.date ?? /(\d{4}-\d{2}-\d{2})$/.exec(metric.key)?.[1];
  return day !== undefined && ISO_DAY.test(day) ? day : null;
};

export type WearableProvenance = Readonly<{
  source: WearableSourceId;
  day: string | null;
}>;

/** "From Oura, 15 Oct 2026"; "From Oura" when the day is not known. */
export const provenanceLine = ({ source, day }: WearableProvenance): string => {
  const label = WEARABLE_SOURCE_LABEL[source];
  return day === null ? `From ${label}` : `From ${label}, ${formatDate(day)}`;
};

/**
 * The line under a cited value in an answer, or null for an attribution stored
 * before #464 (no source). A stored row is JSON, so the source is checked, not
 * trusted.
 */
export const attributionProvenanceLine = (
  attribution: Readonly<{ source?: unknown; day?: unknown }>,
): string | null =>
  isWearableSourceId(attribution.source)
    ? provenanceLine({
        source: attribution.source,
        day:
          typeof attribution.day === "string" && ISO_DAY.test(attribution.day)
            ? attribution.day
            : null,
      })
    : null;

const joinNames = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * The rule behind a pick, when other sources also had a reading: "WHOOP also
 * records this; Oura comes first in a fixed order, so its reading is shown."
 * Null when the chosen source was the only one.
 */
export const pickedSourceLine = (
  chosen: WearableSourceId,
  others: readonly WearableSourceId[],
): string | null => {
  const rest = [...new Set(others)].filter((source) => source !== chosen);
  if (rest.length === 0) return null;
  const verb = rest.length === 1 ? "records" : "record";
  return `${joinNames(rest.map((source) => WEARABLE_SOURCE_LABEL[source]))} also ${verb} this; ${WEARABLE_SOURCE_LABEL[chosen]} comes first in a fixed order, so its reading is shown.`;
};
