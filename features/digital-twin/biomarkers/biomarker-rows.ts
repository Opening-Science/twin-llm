import {
  formatDate,
  formatMetricValue,
  formatNumber,
  isMainSleepKey,
  isoLocalDate,
  metricLabel,
  metricStem,
  roundTo,
  type FormattableMetric,
} from "@/infrastructure/format-measure";
import { type StatusTone } from "@/infrastructure/ui-kit/status-badge";
import {
  metricDay,
  pickedSourceLine,
  provenanceLine,
  sourceOfMetricKey,
  type WearableSourceId,
} from "@/infrastructure/wearable-provenance";
import {
  COMPARABLE_STEMS,
  type HeldBackNote,
  parseSourceRule,
  type SourceRuleNote,
} from "@/infrastructure/wearable-source-rules";
import {
  type Biomarker,
  type ReferenceInterval,
} from "@/packages/biomarkers/anchor-layer";
import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { type PopulationContext } from "@/packages/biomarkers/population";
import {
  placeValue,
  rangeChoice,
  type RangeChoice,
} from "@/packages/biomarkers/range-choice";
import { markerAnatomy, type MarkerAnatomy } from "@/packages/biomarkers/region-anatomy";
import { SYSTEM_IDS } from "@/packages/anatomy/systems";
import {
  VITAL_ANATOMY,
  VITAL_IDS,
  type VitalAnatomy,
  type VitalId,
} from "@/packages/biomarkers/vitals";

import { SYSTEM_LABEL } from "../anatomy/anatomy-copy";
import {
  D11_NO_POSITION,
  SOURCE_ON_EVIDENCE,
  SOURCES_AGREE,
  NO_SOURCE_CHOSEN,
  VALUE_HELD_BACK,
  NO_PUBLISHED_RANGE,
  POSITION_TEXT,
  publishedRange,
  RANGE_NOT_CHOSEN,
  unitMismatch,
  valueCount,
  VITAL_LABEL,
  VITALS_GROUP,
} from "./biomarker-copy";
import { type CohortValue } from "./cohort-handler";

/**
 * The Biomarkers tab as plain rows: one per Anchor marker, grouped by Anchor's
 * own system, then the wearable vitals. Values come from a lab source (the
 * synthetic cohort for the Demo) matched by exact LOINC; nothing is converted.
 */
export type LabValue = CohortValue;

export type RowSource =
  | Readonly<{ kind: "marker"; anatomy: MarkerAnatomy }>
  | Readonly<{ kind: "vital"; anatomy: VitalAnatomy }>;

export type BiomarkerRow = Readonly<{
  id: string;
  label: string;
  /** The English name when it differs from the label. */
  english: string | null;
  group: string;
  value: string | null;
  details: readonly string[];
  /** Extra words search matches: LOINC code, Anchor id, English name. */
  search: string;
  source: RowSource;
  /**
   * How the wearable sources were resolved for this value (#464), as a
   * status in words; null when one source had it, and for Anchor markers.
   */
  sourceStatus?: Readonly<{ tone: StatusTone; label: string }> | null;
}>;

/** The LOINC display up to its first bracket: "Ferritin [Mass/volume] in …" → "Ferritin". */
export const englishName = (marker: Biomarker): string | null => {
  const english = marker.loincDisplay.split(" [")[0]!.trim();
  return english.toLowerCase() === marker.nameDe.toLowerCase() ? null : english;
};

/** As published: up to two decimals, no trailing zeros. */
const published = (value: number): string => {
  const rounded = roundTo(value, 2);
  return formatNumber(rounded, (String(rounded).split(".")[1] ?? "").length);
};

const withUnit = (number: string, unit: string): string =>
  unit === "%" ? `${number}%` : `${number} ${unit}`;

/** Bounds are inclusive and a missing bound is open, as in intervalPosition. */
export const rangeText = (interval: ReferenceInterval): string | null => {
  const unit = interval.unitUcum ?? "";
  const { low, high } = interval;
  if (low !== null && high !== null)
    return withUnit(`${published(low)}–${published(high)}`, unit);
  if (high !== null) return `≤ ${withUnit(published(high), unit)}`;
  if (low !== null) return `≥ ${withUnit(published(low), unit)}`;
  return null;
};

/** The same range choice `range_position` reports (packages/biomarkers/range-choice.ts). */
const rangeLine = (choice: RangeChoice): string => {
  if (choice.kind === "none") return NO_PUBLISHED_RANGE;
  const text = choice.kind === "range" ? rangeText(choice.interval) : null;
  return text ? publishedRange(text) : RANGE_NOT_CHOSEN;
};

const positionLine = (
  lab: LabValue,
  interval: ReferenceInterval | null,
): string | null => {
  const day = formatDate(isoLocalDate(new Date(lab.effectiveAt)));
  const placement = placeValue(lab.value, lab.unitUcum, interval);
  if (placement.kind === "position")
    return `${POSITION_TEXT[placement.position]} · ${day}`;
  if (placement.kind === "unit-mismatch") {
    return `${unitMismatch(placement.unit, placement.rangeUnit)} · ${day}`;
  }
  return day;
};

const markerRow = (
  marker: Biomarker,
  lab: LabValue | undefined,
  context: PopulationContext,
): BiomarkerRow => {
  const choice = rangeChoice(marker.id, context);
  const interval = choice.kind === "range" ? choice.interval : null;
  const english = englishName(marker);
  const position = lab ? positionLine(lab, interval) : null;
  return {
    id: `bm:${marker.id}`,
    label: marker.nameDe,
    english,
    group: SYSTEM_LABEL[marker.systemId],
    value: lab ? withUnit(published(lab.value), lab.unitUcum) : null,
    details: [
      rangeLine(choice),
      ...(marker.blocked ? [D11_NO_POSITION] : []),
      ...(position ? [position] : []),
    ],
    search: [marker.id, marker.loincCode, english ?? ""].join(" "),
    source: { kind: "marker", anatomy: markerAnatomy(marker) },
  };
};

const SYSTEM_ORDER: readonly string[] = SYSTEM_IDS;

/** Every Anchor marker, by system then name; `values` null means no lab source. */
export const markerRows = (
  values: readonly LabValue[] | null,
  context: PopulationContext = {},
  markers: readonly Biomarker[] = listBiomarkers(),
): readonly BiomarkerRow[] => {
  const byLoinc = new Map((values ?? []).map((lab) => [lab.loinc, lab]));
  return [...markers]
    .sort(
      (a, b) =>
        SYSTEM_ORDER.indexOf(a.systemId) - SYSTEM_ORDER.indexOf(b.systemId) ||
        a.nameDe.localeCompare(b.nameDe, "de"),
    )
    .map((marker) => markerRow(marker, byLoinc.get(marker.loincCode), context));
};

export type VitalReading = Readonly<{
  vital: VitalId;
  /** The newest reading shown; null when the newest day is held back and none is newer. */
  metric: FormattableMetric | null;
  /** Later sources in the vitals table with a related measure, not compared (#464). */
  alsoRecordedBy: readonly WearableSourceId[];
  /** Why this reading was used over another source's that day (#464). */
  rule: SourceRuleNote | null;
  /** A newer day whose readings disagree and are held back (#464). */
  heldBack: HeldBackNote | null;
}>;

const sortDay = (metric: FormattableMetric): string =>
  metric.date ?? /\d{4}-\d{2}-\d{2}$/.exec(metric.key)?.[0] ?? "";

const newestFirst = (a: FormattableMetric, b: FormattableMetric): number =>
  sortDay(b).localeCompare(sortDay(a)) ||
  Number(isMainSleepKey(b.key)) - Number(isMainSleepKey(a.key)) ||
  a.key.localeCompare(b.key);

const ruleOf = (metric: FormattableMetric): SourceRuleNote | null =>
  "sourceRule" in metric ? parseSourceRule(metric.sourceRule) : null;

/**
 * One reading per vital, newest day first. Where the vital's stems measure the
 * same thing (HRV, resting heart rate, blood oxygen, steps), every source is a
 * candidate: the server has already left one reading per day under the source
 * rules (#464), so the newest is shown with its rule, unless a newer day was
 * held back. Otherwise the first source in the vitals table with data is
 * shown, as before, and the later ones are named as related measures.
 * Of a day's sleep periods the main sleep wins, so a short rest or a nap is
 * never shown as the night; the key breaks a remaining tie.
 */
export const latestVitals = (
  metrics: readonly FormattableMetric[],
  heldBack: readonly HeldBackNote[] = [],
): readonly VitalReading[] =>
  VITAL_IDS.flatMap((vital): readonly VitalReading[] => {
    const stems = VITAL_ANATOMY[vital].sources;
    const held =
      [...heldBack]
        .filter((note) =>
          note.keys.some((key) =>
            stems.includes(metricStem(key).replace(/\.unknown$/, "")),
          ),
        )
        .sort((a, b) => (b.day ?? "").localeCompare(a.day ?? ""))[0] ?? null;
    const compared = metrics.filter((metric) => {
      const stem = metricStem(metric.key);
      return stems.includes(stem) && COMPARABLE_STEMS[stem] !== undefined;
    });
    if (compared.length > 0 || held !== null) {
      // The server leaves one reading per day; on unresolved input the table's order breaks a tie.
      const newest =
        [...compared].sort(
          (a, b) =>
            sortDay(b).localeCompare(sortDay(a)) ||
            stems.indexOf(metricStem(a.key)) - stems.indexOf(metricStem(b.key)) ||
            newestFirst(a, b),
        )[0] ?? null;
      const heldIsNewer =
        held !== null && (newest === null || (held.day ?? "") > sortDay(newest));
      return [
        {
          vital,
          metric: heldIsNewer ? null : newest,
          alsoRecordedBy: [],
          rule: heldIsNewer || newest === null ? null : ruleOf(newest),
          heldBack: heldIsNewer ? held : null,
        },
      ];
    }
    const withData = stems
      .map((source) => metrics.filter((metric) => metricStem(metric.key) === source))
      .filter((list) => list.length > 0);
    const found = withData[0];
    if (!found) return [];
    const newest = [...found].sort(newestFirst)[0]!;
    const chosen = sourceOfMetricKey(newest.key);
    const alsoRecordedBy = [
      ...new Set(withData.slice(1).map((list) => sourceOfMetricKey(list[0]!.key))),
    ].filter((source) => source !== chosen);
    return [{ vital, metric: newest, alsoRecordedBy, rule: null, heldBack: null }];
  });

const SOURCE_STATUS: Readonly<
  Record<
    SourceRuleNote["kind"] | "held_back",
    Readonly<{ tone: StatusTone; label: string }>
  >
> = {
  agree: { tone: "ok", label: SOURCES_AGREE },
  evidence: { tone: "neutral", label: SOURCE_ON_EVIDENCE },
  held_back: { tone: "warn", label: NO_SOURCE_CHOSEN },
};

export const vitalRows = (readings: readonly VitalReading[]): readonly BiomarkerRow[] =>
  readings.map(({ vital, metric, alsoRecordedBy, rule, heldBack }) => {
    const anatomy = VITAL_ANATOMY[vital];
    const label = VITAL_LABEL[vital];
    const note = anatomy.note === label ? [] : [anatomy.note];
    if (metric === null) {
      return {
        id: `vital:${vital}`,
        label,
        english: null,
        group: VITALS_GROUP,
        value: VALUE_HELD_BACK,
        details: [...note, ...(heldBack === null ? [] : [heldBack.line])],
        search: vital,
        source: { kind: "vital", anatomy },
        sourceStatus: SOURCE_STATUS.held_back,
      };
    }
    const source = sourceOfMetricKey(metric.key);
    const picked = pickedSourceLine(source, alsoRecordedBy);
    return {
      id: `vital:${vital}`,
      label,
      english: metricLabel(metric.key, metric.label),
      group: VITALS_GROUP,
      value: formatMetricValue(metric),
      details: [
        ...note,
        provenanceLine({ source, day: metricDay(metric) }),
        ...(rule === null ? [] : [rule.line]),
        ...(picked ? [picked] : []),
      ],
      search: metric.key,
      source: { kind: "vital", anatomy },
      sourceStatus: rule === null ? null : SOURCE_STATUS[rule.kind],
    };
  });

/**
 * Rows with a value for this subject first, then the rest. Both keep the
 * order they came in (Anchor system, then name; vitals last), so a valued
 * marker stays under its system heading.
 */
export const splitByValue = (
  rows: readonly BiomarkerRow[],
): Readonly<{
  withValues: readonly BiomarkerRow[];
  without: readonly BiomarkerRow[];
}> => ({
  withValues: rows.filter((row) => row.value !== null),
  without: rows.filter((row) => row.value === null),
});

/** "12 with values · 67 in Anchor v3 · 2 wearable vitals": Anchor markers counted apart from vitals. */
export const valueCountLine = (rows: readonly BiomarkerRow[]): string => {
  const markers = rows.filter((row) => row.source.kind === "marker");
  return valueCount(
    markers.filter((row) => row.value !== null).length,
    markers.length,
    rows.filter((row) => row.source.kind === "vital").length,
  );
};

/** The no-value section opens for the person, for a search hit inside it, or for the selected row. */
export const noValueOpen = (
  input: Readonly<{
    userOpen: boolean;
    query: string;
    matches: number;
    selectedInside: boolean;
  }>,
): boolean =>
  input.userOpen ||
  input.selectedInside ||
  (input.query.trim() !== "" && input.matches > 0);
