import { describe, expect, test } from "bun:test";

import {
  MADE_UP_CAUSE_CSV,
  MADE_UP_HALE_CSV,
  MADE_UP_RISK_CSV,
} from "@/packages/gbd-local/made-up-results.test-helpers";
import { type GbdCsvRow, parseGbdResultsCsv } from "@/packages/gbd-local/results-csv";
import type { AppendInput } from "@/packages/audit/append";

import {
  type GbdCatalog,
  type GbdEstimatePorts,
  type GbdEstimateQuery,
  type GbdEstimateResult,
  gbdModelOutput,
  runGbdEstimate,
} from "./gbd-estimate";
import { gbdEstimateInput } from "./gbd-estimate-schema";
import { GBD_NOT_IMPORTED, GBD_ROW_CAP, GBD_TOO_MANY_ROWS } from "./gbd-refusals";
import type { SessionScope } from "./scope";
import { QUERY_TOOL_FAILED } from "./tool-core";

/**
 * `gbd_estimate` over MADE-UP rows in the Results Tool layout (values are not
 * IHME's). Every expected value is written out from the fixture by hand.
 */

const rowsOf = (text: string): readonly GbdCsvRow[] => {
  const parsed = parseGbdResultsCsv(text);
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.rows;
};

const STORED = [
  ...rowsOf(MADE_UP_CAUSE_CSV),
  ...rowsOf(MADE_UP_RISK_CSV),
  ...rowsOf(MADE_UP_HALE_CSV),
];

const distinct = (pairs: readonly (readonly [number | null, string | null])[]) =>
  [
    ...new Map(
      pairs.flatMap(([id, name]) => (id === null || name === null ? [] : [[id, name]])),
    ),
  ]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

const fakePorts = (stored: readonly GbdCsvRow[] = STORED) => {
  const audits: AppendInput[] = [];
  const queries: GbdEstimateQuery[] = [];
  const catalog = async (): Promise<GbdCatalog> => ({
    locations: distinct(stored.map((row) => [row.locationId, row.locationName])),
    causes: distinct(stored.map((row) => [row.causeId, row.causeName])),
    risks: distinct(stored.map((row) => [row.reiId, row.reiName])),
    ages: [...new Set(stored.map((row) => row.ageId))].sort((a, b) => a - b),
  });
  const ports: GbdEstimatePorts = {
    catalog,
    findEstimates: async (query) => {
      queries.push(query);
      return stored
        .filter(
          (row) =>
            row.measureId === query.measureId &&
            row.metricId === query.metricId &&
            row.sexId === query.sexId &&
            row.ageId === query.ageId &&
            query.years.includes(row.year) &&
            query.locationIds.includes(row.locationId) &&
            row.causeId === query.causeId &&
            row.reiId === query.reiId,
        )
        .slice(0, query.take)
        .map((row) => ({
          locationId: row.locationId,
          locationName: row.locationName,
          year: row.year,
          val: row.val,
          upper: row.upper,
          lower: row.lower,
        }));
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, queries };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };
const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };

const CVD_DEATHS = {
  measure: "deaths",
  metric: "rate",
  cause: "Cardiovascular diseases",
  sex: "both",
  age: "age_standardized",
} as const;

const ATTRIBUTION =
  "Population estimate (IHME GBD 2023), not a statement about this person.";

describe("gbd_estimate input", () => {
  test("is closed and needs a cause or risk and exactly one place choice", () => {
    const ok = { ...CVD_DEATHS, locations: ["CHE"], years: [2021] };
    expect(gbdEstimateInput.safeParse(ok).success).toBe(true);
    expect(gbdEstimateInput.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(gbdEstimateInput.safeParse({ ...ok, cause: undefined }).success).toBe(false);
    expect(gbdEstimateInput.safeParse({ ...ok, sdi: true }).success).toBe(false);
    expect(gbdEstimateInput.safeParse({ ...ok, years: [1989] }).success).toBe(false);
    expect(gbdEstimateInput.safeParse({ ...ok, measure: "mortality" }).success).toBe(
      false,
    );
  });
});

const HALE_AT_BIRTH = {
  measure: "hale",
  metric: "years",
  sex: "both",
  age: "at_birth",
} as const;

describe("gbd_estimate input: HALE and life expectancy (#394)", () => {
  test("take metric years and no cause or risk", () => {
    const ok = { ...HALE_AT_BIRTH, locations: ["CHE"], years: [2023] };
    expect(gbdEstimateInput.safeParse(ok).success).toBe(true);
    expect(
      gbdEstimateInput.safeParse({ ...ok, measure: "life_expectancy" }).success,
    ).toBe(true);
    expect(gbdEstimateInput.safeParse({ ...ok, metric: "rate" }).success).toBe(false);
    expect(
      gbdEstimateInput.safeParse({ ...ok, cause: "Cardiovascular diseases" }).success,
    ).toBe(false);
  });

  test("years and at_birth are theirs only", () => {
    const deaths = { ...CVD_DEATHS, locations: ["CHE"], years: [2023] };
    expect(gbdEstimateInput.safeParse({ ...deaths, metric: "years" }).success).toBe(
      false,
    );
    expect(gbdEstimateInput.safeParse({ ...deaths, age: "at_birth" }).success).toBe(
      false,
    );
  });
});

describe("gbd_estimate", () => {
  test("HALE at birth reads the youngest age group, 0-6 days (id 2), with no cause", async () => {
    const { ports, queries } = fakePorts();
    const result = await runGbdEstimate(
      synthetic,
      { ...HALE_AT_BIRTH, locations: ["Switzerland", "Germany"], years: [2023] },
      ports,
    );
    expect(queries[0]?.ageId).toBe(2);
    expect(queries[0]?.causeId).toBeNull();
    expect(queries[0]?.reiId).toBeNull();
    if (!("rows" in result)) throw new Error("refused");
    expect([result.unit, result.cause, result.risk]).toEqual(["years", null, null]);
    expect(result.rows.map((row) => [row.location, row.value])).toEqual([
      ["Switzerland", 70.25],
      ["Germany", 68.75],
    ]);
  });

  test("life expectancy at birth is its own measure", async () => {
    const { ports } = fakePorts();
    const result = await runGbdEstimate(
      synthetic,
      {
        ...HALE_AT_BIRTH,
        measure: "life_expectancy",
        locations: ["Switzerland"],
        years: [2023],
      },
      ports,
    );
    expect("rows" in result ? result.rows.map((row) => row.value) : result).toEqual([
      80.5,
    ]);
  });

  test("at birth with no life table age group imported is refused", async () => {
    const { ports, queries } = fakePorts(rowsOf(MADE_UP_CAUSE_CSV));
    const result = await runGbdEstimate(
      synthetic,
      { ...HALE_AT_BIRTH, locations: ["Switzerland"], years: [2023] },
      ports,
    );
    expect("code" in result ? result.code : null).toBe("GBD_NO_ESTIMATE");
    expect(queries).toEqual([]);
  });

  test("two countries, two years: exact rows and 95% UI, audited without a subject", async () => {
    const { ports, audits } = fakePorts();
    const input = {
      ...CVD_DEATHS,
      locations: ["Switzerland", "DEU"],
      years: [2023, 2021],
    };
    const result = await runGbdEstimate(synthetic, input, ports);
    expect(result).toEqual({
      attribution: ATTRIBUTION,
      source: "IHME GBD 2023",
      measure: "deaths",
      metric: "rate",
      unit: "per 100,000",
      sex: "both",
      age: "age_standardized",
      cause: "Cardiovascular diseases",
      risk: null,
      n: 4,
      rows: [
        {
          location: "Germany",
          location_id: 81,
          iso3: "DEU",
          iso3166_2: null,
          year: 2021,
          value: 150,
          lower: 135.5,
          upper: 165.5,
        },
        {
          location: "Switzerland",
          location_id: 94,
          iso3: "CHE",
          iso3166_2: null,
          year: 2021,
          value: 100.5,
          lower: 90.75,
          upper: 110.25,
        },
        {
          location: "Germany",
          location_id: 81,
          iso3: "DEU",
          iso3166_2: null,
          year: 2023,
          value: 140,
          lower: 125,
          upper: 155,
        },
        {
          location: "Switzerland",
          location_id: 94,
          iso3: "CHE",
          iso3166_2: null,
          year: 2023,
          value: 98.25,
          lower: 88.5,
          upper: 108,
        },
      ],
      not_imported: [],
    });
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: null,
        tool: "gbd_estimate",
        args: input,
        result,
        rowCount: 4,
      },
    ]);
  });

  test("personal mode reads the same population rows", async () => {
    const { ports } = fakePorts();
    const input = { ...CVD_DEATHS, locations: ["CHE"], years: [2021] };
    const result = await runGbdEstimate(personal, input, ports);
    expect("rows" in result ? result.rows.map((row) => row.value) : null).toEqual([
      100.5,
    ]);
  });

  test("children_of: the imported US states, with ISO 3166-2", async () => {
    const { ports } = fakePorts();
    const result = await runGbdEstimate(
      synthetic,
      { ...CVD_DEATHS, children_of: "USA", years: [2021] },
      ports,
    );
    expect(
      "rows" in result
        ? result.rows.map((row) => [row.location, row.iso3166_2, row.value])
        : result,
    ).toEqual([
      ["Alabama", "US-AL", 220],
      ["Georgia", "US-GA", 210],
      ["Alaska", "US-AK", 120],
    ]);
  });

  test("sdi: the imported SDI groups", async () => {
    const { ports } = fakePorts();
    const result = await runGbdEstimate(
      synthetic,
      { ...CVD_DEATHS, sdi: true, years: [2021] },
      ports,
    );
    expect(
      "rows" in result ? result.rows.map((row) => [row.location, row.value]) : result,
    ).toEqual([
      ["Low SDI", 250],
      ["High SDI", 130],
    ]);
  });

  test("a risk factor alone is its all-cause burden", async () => {
    const { ports } = fakePorts();
    const result = await runGbdEstimate(
      synthetic,
      {
        measure: "dalys",
        metric: "rate",
        risk: "high systolic blood pressure",
        sex: "both",
        age: "all_ages",
        locations: ["CHE"],
        years: [2021],
      },
      ports,
    );
    expect(
      "rows" in result ? [result.risk, result.cause, result.rows[0]?.value] : result,
    ).toEqual(["High systolic blood pressure", "All causes", 800]);
  });

  test("asked years without an estimate are listed, not filled", async () => {
    const { ports } = fakePorts();
    const result = await runGbdEstimate(
      synthetic,
      { ...CVD_DEATHS, locations: ["Alaska"], years: [2021, 2023] },
      ports,
    );
    expect("not_imported" in result ? result.not_imported : result).toEqual([
      { location: "Alaska", year: 2023 },
    ]);
  });

  test("nothing imported: GBD_NOT_IMPORTED, audited with 0 rows", async () => {
    const { ports, audits, queries } = fakePorts([]);
    expect(
      await runGbdEstimate(
        synthetic,
        { ...CVD_DEATHS, locations: ["CHE"], years: [2021] },
        ports,
      ),
    ).toEqual(GBD_NOT_IMPORTED);
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [GBD_NOT_IMPORTED, 0],
    ]);
  });

  test("an unknown or repeated place name is refused before any read", async () => {
    const { ports, queries } = fakePorts();
    expect(
      await runGbdEstimate(
        synthetic,
        { ...CVD_DEATHS, locations: ["Atlantis"], years: [2021] },
        ports,
      ),
    ).toEqual({
      code: "GBD_UNKNOWN_LOCATION",
      error:
        "no GBD location has this name, ISO 3166-1 alpha-3 or ISO 3166-2 code, or it has no imported estimates",
      query: "Atlantis",
    });
    expect(
      await runGbdEstimate(
        synthetic,
        { ...CVD_DEATHS, locations: ["Georgia"], years: [2021] },
        ports,
      ),
    ).toEqual({
      code: "GBD_AMBIGUOUS_LOCATION",
      error: "more than one GBD location has this name; ask again with an ISO code",
      query: "Georgia",
      options: ["Georgia (GEO)", "Georgia (US-GA)"],
    });
    expect(queries).toEqual([]);
  });

  test("an unknown cause or risk lists what is imported", async () => {
    const { ports } = fakePorts();
    expect(
      await runGbdEstimate(
        synthetic,
        { ...CVD_DEATHS, cause: "Neoplasms", locations: ["CHE"], years: [2021] },
        ports,
      ),
    ).toEqual({
      code: "GBD_UNKNOWN_CAUSE",
      error: "no imported GBD estimate is for a cause with this name",
      query: "Neoplasms",
      options: ["All causes", "Cardiovascular diseases"],
    });
    const risk = await runGbdEstimate(
      synthetic,
      { ...CVD_DEATHS, risk: "Smoking", locations: ["CHE"], years: [2021] },
      ports,
    );
    expect("code" in risk ? [risk.code, risk.options] : risk).toEqual([
      "GBD_UNKNOWN_RISK",
      ["High systolic blood pressure"],
    ]);
  });

  test("no matching estimate, no child imported, no SDI: coded refusals", async () => {
    const { ports } = fakePorts();
    const none = await runGbdEstimate(
      synthetic,
      { ...CVD_DEATHS, sex: "female", locations: ["CHE"], years: [2021] },
      ports,
    );
    expect("code" in none ? none.code : none).toBe("GBD_NO_ESTIMATE");
    const children = await runGbdEstimate(
      synthetic,
      { ...CVD_DEATHS, children_of: "Switzerland", years: [2021] },
      ports,
    );
    expect("code" in children ? children.error : children).toBe(
      "the imported GBD results hold no estimate for any location inside Switzerland",
    );
    const { ports: noSdi } = fakePorts(rowsOf(MADE_UP_RISK_CSV));
    const sdi = await runGbdEstimate(
      synthetic,
      { ...CVD_DEATHS, sdi: true, years: [2021] },
      noSdi,
    );
    expect("code" in sdi ? sdi.code : sdi).toBe("GBD_NO_SDI");
  });

  test("more than GBD_ROW_CAP matching estimates is refused, not cut", async () => {
    const [first] = rowsOf(MADE_UP_CAUSE_CSV);
    if (first === undefined) throw new Error("fixture");
    const many = Array.from({ length: GBD_ROW_CAP + 1 }, (_, index) => ({
      ...first,
      locationId: 100_000 + index,
      locationName: `Made-up place ${index}`,
    }));
    const { ports, audits } = fakePorts([first, ...many]);
    const findEstimates: GbdEstimatePorts["findEstimates"] = async (query) =>
      many.slice(0, query.take).map((row) => ({
        locationId: row.locationId,
        locationName: row.locationName,
        year: row.year,
        val: row.val,
        upper: row.upper,
        lower: row.lower,
      }));
    expect(
      await runGbdEstimate(
        synthetic,
        { ...CVD_DEATHS, locations: ["CHE"], years: [2021] },
        { ...ports, findEstimates },
      ),
    ).toEqual(GBD_TOO_MANY_ROWS);
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a read that throws is audited with 0 rows and no message", async () => {
    const { ports, audits } = fakePorts();
    await expect(
      runGbdEstimate(
        synthetic,
        { ...CVD_DEATHS, locations: ["CHE"], years: [2021] },
        { ...ports, findEstimates: () => Promise.reject(new Error("made-up outage")) },
      ),
    ).rejects.toThrow("made-up outage");
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});

describe("gbdModelOutput (#394)", () => {
  const rowAt = (index: number) => ({
    location: `Made-up place ${index}`,
    location_id: 100_000 + index,
    iso3: null,
    iso3166_2: null,
    year: 2023,
    value: 100 - index,
    lower: null,
    upper: null,
  });
  const resultOf = (n: number): GbdEstimateResult => ({
    attribution: ATTRIBUTION,
    source: "IHME GBD 2023",
    measure: "hale",
    metric: "years",
    unit: "years",
    sex: "both",
    age: "at_birth",
    cause: null,
    risk: null,
    n,
    rows: Array.from({ length: n }, (_, index) => rowAt(index)),
    not_imported: [],
  });

  test("a short result reaches the model whole", () => {
    expect(gbdModelOutput(resultOf(30))).toEqual(resultOf(30));
    expect(gbdModelOutput(GBD_NOT_IMPORTED)).toEqual(GBD_NOT_IMPORTED);
  });

  test("a long one keeps n and gives the 10 highest and 5 lowest values", () => {
    const out = gbdModelOutput(resultOf(204));
    expect("n" in out ? out.n : null).toBe(204);
    expect("rows" in out ? out.rows.map((row) => row.value) : []).toEqual([
      100, 99, 98, 97, 96, 95, 94, 93, 92, 91, -99, -100, -101, -102, -103,
    ]);
    expect("rows_shown" in out ? out.rows_shown : null).toBe(
      "15 of 204 rows: the 10 highest and 5 lowest values; the map and the panel show all",
    );
  });
});
