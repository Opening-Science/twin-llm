/**
 * Where a wearable number comes from, in plain words (#464): the source that
 * recorded it and its day, and, where the app picked one source over others,
 * the rule it used. Pure, so the chat's evidence chips and the Digital Twin's
 * vitals share it on server and client. It names a source by its product
 * name only: never a stored key, a vendor id or a subject id.
 *
 * Nothing here combines sources. Where sources overlap on a measure and day,
 * `wearable-source-rules.ts` decides which reading is used, or holds it back;
 * every value shown was still recorded by one source.
 */
import { VALUE_CHECK_STATUSES, type ValueCheckStatus } from "./cited-value-check";
import { formatDate, formatMetricValue } from "./format-measure";

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

const storedDay = (day: unknown): string | null =>
  typeof day === "string" && ISO_DAY.test(day) ? day : null;

const LABEL_DAY = /\s*\((\d{4}-\d{2}-\d{2})\)\s*$/;

/**
 * A cited value as people read it: "Steps, 11 Nov 2026" and "8,120", not the
 * stored "Steps (2026-11-11)" and 8120. The day is the attribution's own, else
 * the one the stored label ends with; the value goes through the same
 * formatter as the Digital Twin's.
 */
export const citedValueText = (
  attribution: Readonly<{
    metricKey: string;
    label: string;
    value: string | number;
    unit?: string;
    day?: unknown;
  }>,
): Readonly<{ heading: string; value: string }> => {
  const day =
    storedDay(attribution.day) ?? LABEL_DAY.exec(attribution.label)?.[1] ?? null;
  const label = attribution.label.replace(LABEL_DAY, "");
  return {
    heading: day === null ? label : `${label}, ${formatDate(day)}`,
    value: formatMetricValue({
      key: attribution.metricKey,
      value: attribution.value,
      ...(attribution.unit === undefined ? {} : { unit: attribution.unit }),
    }),
  };
};

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
    ? provenanceLine({ source: attribution.source, day: storedDay(attribution.day) })
    : null;

const isValueCheck = (
  value: unknown,
): value is Readonly<{ status: ValueCheckStatus; stated?: unknown }> =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  (VALUE_CHECK_STATUSES as readonly unknown[]).includes(value.status);

/**
 * The line under a cited value once the number the answer states for it has
 * been checked against the stored reading (#545). A match names the reading's
 * source and day ("Matches the Oura reading, 2 Jan 2026"); a number that does
 * not match gets no source, only what the answer said ("Doesn't match the cited
 * reading: the answer says 75"). A value the answer states no number for, or an
 * answer stored before the check, keeps its provenance line.
 */
export const citedValueLine = (
  attribution: Readonly<{ source?: unknown; day?: unknown; valueCheck?: unknown }>,
): string | null => {
  const check = attribution.valueCheck;
  if (!isValueCheck(check) || check.status === "unstated") {
    return attributionProvenanceLine(attribution);
  }
  if (check.status === "not_matched") {
    return typeof check.stated === "string" && check.stated !== ""
      ? `Doesn't match the cited reading: the answer says ${check.stated}`
      : "Doesn't match the cited reading";
  }
  if (!isWearableSourceId(attribution.source)) return "Matches the cited reading";
  const reading = `Matches the ${WEARABLE_SOURCE_LABEL[attribution.source]} reading`;
  const day = storedDay(attribution.day);
  return day === null ? reading : `${reading}, ${formatDate(day)}`;
};

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
