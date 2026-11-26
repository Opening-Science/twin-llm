import { anchorLayer, type AnchorLayer } from "@/packages/biomarkers/anchor-layer";
import { LAB_TEST_NAMES } from "@/packages/personal-data/lab-test-names";
import { isLoincCode } from "@/packages/personal-data/loinc-code";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";
import { COHORT_MEASURE_NAMES } from "@/packages/warehouse/cohort-measure-names";

import {
  type AmbiguousMeasure,
  ambiguousMeasure,
  invalidLoinc,
  type MeasureRefusal,
  unknownMeasure,
} from "./measure-refusals";

/**
 * Measure names to LOINC codes for the query tools (#900), so a model names
 * "LDL cholesterol" and the code comes from a table, never from the model.
 *
 * The names come from tables the repo already keeps, and every code from
 * them: the lab import's names (`lab-test-names.ts`, Anchor codes), Anchor's
 * German names, the short names of the synthetic cohort's codes
 * (`cohort-measure-names.ts`), the wearable measures with a code, and the
 * query names below. A name is matched whole after `normaliseMeasureName`:
 * no fuzzy matching and no guessing from parts. A name that fits several
 * codes (plain "glucose", "LDL", "creatinine") keeps them all; the tool then
 * keeps the ones the subject has readings of, and refuses with the list when
 * that still leaves none or several.
 *
 * Pure: no database and no Node import.
 */

/**
 * Names the import table leaves out because they fit more than one code, and
 * everyday names for cohort codes. Codes only from the tables above.
 */
export const QUERY_MEASURE_NAMES: Readonly<Record<string, readonly string[]>> = {
  "LDL cholesterol": ["18262-6", "2089-1"],
  LDL: ["18262-6", "2089-1"],
  "LDL-C": ["18262-6", "2089-1"],
  "LDL-Cholesterin": ["18262-6", "2089-1"],
  HDL: ["2085-9"],
  cholesterol: ["2093-3"],
  Cholesterin: ["2093-3"],
  glucose: ["2339-0", "2345-7", "1558-6"],
  "blood glucose": ["2339-0"],
  "blood sugar": ["2339-0", "2345-7"],
  Glukose: ["2339-0", "2345-7", "1558-6"],
  Blutzucker: ["2339-0", "2345-7"],
  A1c: ["4548-4"],
  "glycated haemoglobin": ["4548-4"],
  "glycated hemoglobin": ["4548-4"],
  "glykiertes Hämoglobin": ["4548-4"],
  "blood pressure": ["8480-6", "8462-4"],
  Blutdruck: ["8480-6", "8462-4"],
  systolic: ["8480-6"],
  "systolic BP": ["8480-6"],
  "systolischer Blutdruck": ["8480-6"],
  diastolic: ["8462-4"],
  "diastolic BP": ["8462-4"],
  "diastolischer Blutdruck": ["8462-4"],
  pulse: ["8867-4"],
  Puls: ["8867-4"],
  Herzfrequenz: ["8867-4"],
  Ruhepuls: ["40443-4"],
  weight: ["29463-7"],
  Gewicht: ["29463-7"],
  Körpergewicht: ["29463-7"],
  height: ["8302-2"],
  Körpergröße: ["8302-2"],
  BMI: ["39156-5"],
  temperature: ["8310-5"],
  Körpertemperatur: ["8310-5"],
  SpO2: ["59408-5", "2708-6"],
  "oxygen saturation": ["59408-5", "2708-6"],
  Sauerstoffsättigung: ["59408-5", "2708-6"],
  Atemfrequenz: ["9279-1"],
  GFR: ["33914-3"],
  "glomerular filtration rate": ["33914-3"],
  creatinine: ["2160-0", "38483-4"],
  Kreatinin: ["2160-0", "38483-4"],
  potassium: ["2823-3", "6298-4"],
  sodium: ["2951-2", "2947-0"],
  chloride: ["2075-0", "2069-3"],
  calcium: ["2000-8", "17861-6", "49765-1"],
  magnesium: ["2601-3", "19123-9", "21377-7"],
  CRP: ["1988-5", "30522-7"],
  "C-reactive protein": ["1988-5", "30522-7"],
  RDW: ["788-0"],
  "NT-proBNP": ["33762-6", "71425-3"],
  troponin: ["89579-7"],
  "vitamin D": ["1989-3"],
};

/**
 * Lower case, NFC, umlauts and ß spelt out (`Hämoglobin` and `haemoglobin`
 * meet), hyphens, underscores and dots as spaces, single spaces. Nothing else.
 */
export const normaliseMeasureName = (name: string): string =>
  name
    .normalize("NFC")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[-_.]/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export type MeasureCandidate = Readonly<{ loinc: string; name: string }>;

/** Digits, a hyphen, digits: written as a code, whether or not it is a valid one. */
const LOINC_SHAPE = /^\d{1,7}-\d+$/;

export type MeasureCatalogue = Readonly<{
  /** Normalised name → the codes it may mean, sorted. */
  codesByName: ReadonlyMap<string, readonly string[]>;
  /** Normalised name → the name as first written, for suggestions. */
  spelling: ReadonlyMap<string, string>;
  /** Code → the plain name a candidate list shows. */
  nameOfCode: ReadonlyMap<string, string>;
}>;

type NamedCode = readonly [name: string, code: string];

const anchorNames = (layer: AnchorLayer): readonly NamedCode[] => {
  const usable = layer.biomarkers.filter((marker) => !marker.blocked);
  const byId = new Map(usable.map((marker) => [marker.id, marker.loincCode]));
  return [
    ...usable.map((marker): NamedCode => [marker.nameDe, marker.loincCode]),
    ...Object.entries(LAB_TEST_NAMES).flatMap(([id, names]) => {
      const code = byId.get(id);
      return code === undefined ? [] : names.map((name): NamedCode => [name, code]);
    }),
  ];
};

const wearableNames = (): readonly NamedCode[] =>
  Object.values(MEASURES).flatMap((measure) =>
    measure.code === null ? [] : [[measure.display, measure.code] as const],
  );

const cohortNames = (): readonly NamedCode[] =>
  [...COHORT_MEASURE_NAMES].map(([code, name]): NamedCode => [name, code]);

const queryNames = (): readonly NamedCode[] =>
  Object.entries(QUERY_MEASURE_NAMES).flatMap(([name, codes]) =>
    codes.map((code): NamedCode => [name, code]),
  );

/** Codes in numeric order: `788-0` before `2089-1`. */
const compareCodes = (a: string, b: string): number =>
  Number(a.split("-")[0]) - Number(b.split("-")[0]) || a.localeCompare(b);

/** The catalogue from the repo's tables; tests may pass another Anchor layer. */
export const buildMeasureCatalogue = (
  layer: AnchorLayer = anchorLayer,
): MeasureCatalogue => {
  const anchor = anchorNames(layer);
  // Plain names, best first: the cohort's short English name, then the
  // wearable's, then LOINC's own name from Anchor.
  const display: readonly NamedCode[] = [
    ...cohortNames(),
    ...wearableNames(),
    ...layer.biomarkers.map((marker): NamedCode => [
      marker.loincDisplay,
      marker.loincCode,
    ]),
  ];
  const all = [...cohortNames(), ...wearableNames(), ...anchor, ...queryNames()];
  const codesByName = all.reduce((index, [name, code]) => {
    const key = normaliseMeasureName(name);
    const codes = index.get(key) ?? [];
    return codes.includes(code) ? index : new Map(index).set(key, [...codes, code]);
  }, new Map<string, readonly string[]>());
  const spelling = all.reduce((index, [name]) => {
    const key = normaliseMeasureName(name);
    return index.has(key) ? index : new Map(index).set(key, name);
  }, new Map<string, string>());
  const nameOfCode = display.reduce(
    (index, [name, code]) => (index.has(code) ? index : new Map(index).set(code, name)),
    new Map<string, string>(),
  );
  return {
    codesByName: new Map(
      [...codesByName].map(([key, codes]) => [key, [...codes].sort(compareCodes)]),
    ),
    spelling,
    nameOfCode,
  };
};

const PINNED_CATALOGUE = buildMeasureCatalogue();

/** The catalogue over the pinned tables, built once at load. */
export const measureCatalogue = (): MeasureCatalogue => PINNED_CATALOGUE;

const candidate = (catalogue: MeasureCatalogue, loinc: string): MeasureCandidate => ({
  loinc,
  name: catalogue.nameOfCode.get(loinc) ?? loinc,
});

/** Every code a name may mean, with its plain name; empty when the name is unknown. */
export const measureCandidates = (
  measure: string,
  catalogue: MeasureCatalogue = measureCatalogue(),
): readonly MeasureCandidate[] =>
  (catalogue.codesByName.get(normaliseMeasureName(measure)) ?? []).map((loinc) =>
    candidate(catalogue, loinc),
  );

const SUGGESTION_LIMIT = 8;

const wordsOf = (name: string): readonly string[] =>
  normaliseMeasureName(name)
    .split(" ")
    .filter((word) => word.length >= 3);

/**
 * Known names sharing a word of three letters or more with an unknown one,
 * most shared words first, then alphabetically; at most 8. Suggestions to
 * choose from, never a match.
 */
export const measureSuggestions = (
  measure: string,
  catalogue: MeasureCatalogue = measureCatalogue(),
): readonly Readonly<{ measure: string; loinc: readonly string[] }>[] => {
  const asked = new Set(wordsOf(measure));
  if (asked.size === 0) return [];
  return (
    [...catalogue.codesByName]
      .map(([key, codes]) => ({
        key,
        codes,
        shared: key.split(" ").filter((word) => asked.has(word)).length,
      }))
      .filter((entry) => entry.shared > 0)
      .sort((a, b) => b.shared - a.shared || a.key.localeCompare(b.key))
      // One name per set of codes: "LDL" and "LDL-C" are one suggestion.
      .filter(
        (entry, index, all) =>
          all.findIndex((other) => other.codes.join() === entry.codes.join()) === index,
      )
      .slice(0, SUGGESTION_LIMIT)
      .map((entry) => ({
        measure: catalogue.spelling.get(entry.key) ?? entry.key,
        loinc: entry.codes,
      }))
  );
};

export type ResolvedMeasure = Readonly<{
  /** The name as the call gave it. */
  measure: string;
  loinc: string;
  /** The code's plain name. */
  name: string;
}>;

export type MeasureRequest = Readonly<{
  loinc: readonly string[];
  measure: readonly string[];
}>;

export type MeasureResolution = Readonly<{
  /** Codes to read: the given codes, then each resolved name's, once each. */
  codes: readonly string[];
  resolved: readonly ResolvedMeasure[];
}>;

/** Whether resolving these names needs to know which codes have readings. */
export const needsReadings = (
  names: readonly string[],
  catalogue: MeasureCatalogue = measureCatalogue(),
): boolean => names.some((name) => measureCandidates(name, catalogue).length > 1);

type Picked =
  | Readonly<{ ok: true; resolved: ResolvedMeasure }>
  | Readonly<{ ok: false; refusal: AmbiguousMeasure }>;

const pick = (
  measure: string,
  candidates: readonly MeasureCandidate[],
  withReadings: ReadonlySet<string>,
): Picked => {
  const kept =
    candidates.length === 1
      ? candidates
      : candidates.filter((entry) => withReadings.has(entry.loinc));
  const only = kept.length === 1 ? kept[0] : undefined;
  return only !== undefined
    ? { ok: true, resolved: { measure, ...only } }
    : {
        ok: false,
        refusal: ambiguousMeasure(
          measure,
          candidates.map((entry) => ({
            ...entry,
            has_readings: withReadings.has(entry.loinc),
          })),
        ),
      };
};

/**
 * Codes for a call that names measures by code, by name or both. A code
 * that fails LOINC's check digit is refused; a name is looked up whole; a
 * name with several codes keeps the one `held` says has readings, and is
 * refused with every candidate when none or several do. `held` is asked
 * once, and only when a name has several codes. A code from a name always
 * comes from the table, so a made-up code never reaches a read. A `measure`
 * written as a code (`4548-4`) is read as a code, check digit and all.
 */
export const resolveMeasures = async (
  request: MeasureRequest,
  held: (codes: readonly string[]) => Promise<ReadonlySet<string>>,
  catalogue: MeasureCatalogue = measureCatalogue(),
): Promise<MeasureResolution | MeasureRefusal> => {
  const codeShaped = request.measure.filter((measure) =>
    LOINC_SHAPE.test(measure.trim()),
  );
  const given = [...request.loinc, ...codeShaped.map((measure) => measure.trim())];
  const invalid = given.filter((code) => !isLoincCode(code));
  if (invalid.length > 0) return invalidLoinc(invalid);
  const names = request.measure.filter((measure) => !codeShaped.includes(measure));
  const looked = names.map((measure) => ({
    measure,
    candidates: measureCandidates(measure, catalogue),
  }));
  const unknown = looked.find((entry) => entry.candidates.length === 0);
  if (unknown !== undefined) {
    return unknownMeasure(
      unknown.measure,
      measureSuggestions(unknown.measure, catalogue),
    );
  }
  const asked = [
    ...new Set(
      looked
        .filter((entry) => entry.candidates.length > 1)
        .flatMap((entry) => entry.candidates.map((c) => c.loinc)),
    ),
  ];
  const withReadings = asked.length === 0 ? new Set<string>() : await held(asked);
  const picked = looked.map((entry) =>
    pick(entry.measure, entry.candidates, withReadings),
  );
  const resolved = picked.flatMap((entry) => (entry.ok ? [entry.resolved] : []));
  const refused = picked.flatMap((entry) => (entry.ok ? [] : [entry.refusal]));
  if (refused[0] !== undefined) return refused[0];
  return {
    codes: [...new Set([...given, ...resolved.map((entry) => entry.loinc)])],
    resolved,
  };
};
