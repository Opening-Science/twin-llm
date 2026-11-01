/**
 * bun scripts/geo/match-rate.ts
 *
 * How many GBD subnational units find a state or province boundary, per
 * country GBD estimates below country level. Each unit is matched the way the
 * map matches an estimate (`features/chat/map-view.ts`): its ISO 3166-2 code
 * first, then its name, among the boundaries of its own country. Prints a
 * Markdown report; `docs/gbd-map-coverage.md` holds its output.
 *
 * Reads the committed location table (ids, names and codes, no estimates) and
 * the committed boundary index. Pure apart from the printing.
 */
import { GBD_LOCATION_TABLE } from "../../packages/gbd-local/location-table";
import {
  LOCATION_INDEX,
  type LocationIndex,
  normalizeName,
} from "../../infrastructure/charts/choropleth/match-location";

import { GBD_SUBNATIONAL } from "./boundary-rules";
import { UNMATCHED_ON_PURPOSE } from "./gbd-boundaries";

export type Unit = Readonly<{
  id: number;
  level: number;
  name: string;
  iso3: string;
  iso3166_2: string | null;
}>;

export type How = "code" | "name" | "other name" | "none";

export type UnitMatch = Unit & Readonly<{ how: How; code: string | null }>;

/** The boundary a unit matches and how: by code, by the boundary's own name or by one of its other names. */
export const matchUnit = (index: LocationIndex, unit: Unit): UnitMatch => {
  const states = index.states.filter((state) => state.country === unit.iso3);
  const byCode =
    unit.iso3166_2 === null
      ? undefined
      : states.find((state) => state.code === unit.iso3166_2);
  if (byCode !== undefined) return { ...unit, how: "code", code: byCode.code };
  const wanted = normalizeName(unit.name);
  const byName = states.find((state) =>
    [state.name, ...state.names].some((name) => normalizeName(name) === wanted),
  );
  if (byName === undefined) return { ...unit, how: "none", code: null };
  const how = normalizeName(byName.name) === wanted ? "name" : "other name";
  return { ...unit, how, code: byName.code };
};

export type CountryReport = Readonly<{
  country: string;
  units: number;
  byCode: number;
  byName: number;
  byOtherName: number;
  unmatched: readonly UnitMatch[];
  otherName: readonly UnitMatch[];
  /** Boundaries two or more units match; the map can colour only one of them. */
  shared: readonly Readonly<{ code: string; names: readonly string[] }>[];
}>;

/** Subnational units of the table (level 4 and below) that carry this country's alpha-3. */
export const unitsOf = (
  table: readonly (readonly [
    number,
    number | null,
    number,
    string,
    string | null,
    string | null,
  ])[],
  country: string,
): readonly Unit[] =>
  table.flatMap(([id, , level, name, iso3, iso3166_2]) =>
    level >= 4 && iso3 === country ? [{ id, level, name, iso3, iso3166_2 }] : [],
  );

export const countryReport = (
  index: LocationIndex,
  country: string,
  units: readonly Unit[],
): CountryReport => {
  const matches = units.map((unit) => matchUnit(index, unit));
  const count = (how: How) => matches.filter((match) => match.how === how).length;
  const codes = [
    ...new Set(matches.flatMap((match) => (match.code === null ? [] : [match.code]))),
  ];
  return {
    country,
    units: units.length,
    byCode: count("code"),
    byName: count("name"),
    byOtherName: count("other name"),
    unmatched: matches.filter((match) => match.how === "none"),
    otherName: matches.filter((match) => match.how === "other name"),
    shared: codes.flatMap((code) => {
      const names = matches.filter((match) => match.code === code).map((m) => m.name);
      return names.length > 1 ? [{ code, names }] : [];
    }),
  };
};

const percent = (part: number, whole: number): string =>
  whole === 0 ? "n/a" : `${Math.round((100 * part) / whole)}%`;

/** Why a unit is left unmatched on purpose, when the reviewed list says so. */
export const unmatchedReason = (country: string, name: string): string | null =>
  UNMATCHED_ON_PURPOSE[country]?.find((entry) => entry.pattern.test(name))?.reason ??
  null;

export const renderReport = (reports: readonly CountryReport[]): string => {
  const matched = (report: CountryReport) =>
    report.byCode + report.byName + report.byOtherName;
  const total = reports.reduce((sum, report) => sum + report.units, 0);
  const totalMatched = reports.reduce((sum, report) => sum + matched(report), 0);
  const lines = [
    "| Country | GBD units | By code | By name | By other name | Unmatched | Matched |",
    "| ------- | --------: | ------: | ------: | ------------: | --------: | ------: |",
    ...reports.map(
      (report) =>
        `| ${report.country} | ${report.units} | ${report.byCode} | ${report.byName} | ${report.byOtherName} | ${report.unmatched.length} | ${percent(matched(report), report.units)} |`,
    ),
    `| All | ${total} | | | | ${total - totalMatched} | ${percent(totalMatched, total)} |`,
    "",
  ];
  const details = reports.flatMap((report) => {
    const reasons = [
      ...new Set(
        report.unmatched.map((unit) => unmatchedReason(report.country, unit.name)),
      ),
    ];
    const notes = [
      ...reasons.map((reason) => {
        const names = report.unmatched
          .filter((unit) => unmatchedReason(report.country, unit.name) === reason)
          .map((unit) => unit.name);
        return `- unmatched, ${reason ?? "no reason recorded"}: ${names.join("; ")}`;
      }),
      ...report.otherName.map(
        (unit) => `- by other name: ${unit.name} -> ${unit.code ?? ""}`,
      ),
      ...report.shared.map(
        (entry) =>
          `- one boundary for several units: ${entry.code} (${entry.names.join("; ")})`,
      ),
    ];
    return notes.length === 0 ? [] : [`### ${report.country}`, "", ...notes, ""];
  });
  return [...lines, ...details].join("\n");
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const reports = GBD_SUBNATIONAL.map((country) =>
    countryReport(LOCATION_INDEX, country, unitsOf(GBD_LOCATION_TABLE, country)),
  );
  console.log(renderReport(reports));
}
