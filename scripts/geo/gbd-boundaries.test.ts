import { describe, expect, test } from "bun:test";

import { LOCATION_INDEX } from "../../infrastructure/charts/choropleth/match-location";
import { GBD_LOCATION_TABLE } from "../../packages/gbd-local/location-table";
import { ISO_3166_2_BY_NAME } from "../gbd/iso-3166-2";

import { GBD_SUBNATIONAL } from "./boundary-rules";
import { GBD_BOUNDARY_RULES } from "./gbd-boundaries";
import { countryReport, unitsOf, unmatchedReason } from "./match-rate";

/** Checks on the committed table, index and rules together (#397). */
const reports = GBD_SUBNATIONAL.map((country) =>
  countryReport(LOCATION_INDEX, country, unitsOf(GBD_LOCATION_TABLE, country)),
);

describe("committed boundaries against GBD's units", () => {
  test("every unmatched unit is unmatched on purpose, with a reason", () => {
    const unexplained = reports.flatMap((report) =>
      report.unmatched
        .filter((unit) => unmatchedReason(report.country, unit.name) === null)
        .map((unit) => `${report.country}: ${unit.name}`),
    );
    expect(unexplained).toEqual([]);
  });

  test("no boundary stands for two units", () => {
    expect(reports.flatMap((report) => report.shared)).toEqual([]);
  });

  test("other names match only through the reviewed aliases", () => {
    const loose = reports.flatMap((report) =>
      report.otherName
        .filter(
          (unit) =>
            GBD_BOUNDARY_RULES[report.country]?.aliases?.[unit.name] !== unit.code,
        )
        .map((unit) => `${report.country}: ${unit.name} -> ${unit.code ?? ""}`),
    );
    expect(loose).toEqual([]);
  });

  test("a unit with an ISO 3166-2 code matches by that code when its country's file has it", () => {
    const units = GBD_SUBNATIONAL.flatMap((country) =>
      unitsOf(GBD_LOCATION_TABLE, country),
    );
    const astray = units.filter((unit) => {
      if (unit.iso3166_2 === null) return false;
      const codes = LOCATION_INDEX.states
        .filter((state) => state.country === unit.iso3)
        .map((state) => state.code);
      return (
        !codes.includes(unit.iso3166_2) && unmatchedReason(unit.iso3, unit.name) === null
      );
    });
    expect(astray.map((unit) => `${unit.name} ${unit.iso3166_2 ?? ""}`)).toEqual([]);
  });

  test("a recoded or dissolved boundary carries a code of the hand ISO table or a GBD id", () => {
    const isoCodes = new Set(
      Object.values(ISO_3166_2_BY_NAME).flatMap((byName) => Object.values(byName)),
    );
    const made = Object.values(GBD_BOUNDARY_RULES).flatMap((rules) => [
      ...Object.values(rules.recode ?? {}),
      ...(rules.dissolve ?? []).map((rule) => rule.code),
    ]);
    expect(made.filter((code) => !isoCodes.has(code) && !/^GBD-\d+$/.test(code))).toEqual(
      [],
    );
    const gbdIds = new Set(GBD_LOCATION_TABLE.map(([id]) => `GBD-${id}`));
    expect(made.filter((code) => code.startsWith("GBD-") && !gbdIds.has(code))).toEqual(
      [],
    );
  });

  test("the match rate does not fall below today's", () => {
    const matched = reports.reduce(
      (sum, report) => sum + report.byCode + report.byName + report.byOtherName,
      0,
    );
    expect(matched).toBeGreaterThanOrEqual(714);
  });
});
