/**
 * The Data page's cohort queries against a real Postgres. Needs a throwaway,
 * migrated DATABASE_URL; the test writes a handful of synthetic rows into
 * cohort `synthea-v4-seed1099`, refuses to start if that cohort already has
 * subjects there, and deletes its rows at the end.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway> bun test features/data-explorer/cohort-queries.live.test.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";

import { readCohortAggregates, readSubjectPage } from "./cohort-queries";
import { type SubjectQuery } from "./subject-table";

const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const databaseUrl = String(Reflect.get(process.env, "DATABASE_URL") ?? "");

const COHORT = "synthea-v4-seed1099";
const OTHER_COHORT = "not-an-allowlisted-cohort";

type Reading = readonly [loinc: string, unit: string, iso: string];

/** ref → readings. `t-b_03` has none. */
const READINGS: Readonly<Record<string, readonly Reading[]>> = {
  "t-aa01": [
    ["29463-7", "kg", "2010-06-01"],
    ["29463-7", "kg", "2012-06-01"],
    ["4548-4", "%", "2011-06-01"],
    ["4548-4", "%", "2013-06-01"],
    ["4548-4", "%", "2014-06-01"],
  ],
  "t-ab02": [
    ["29463-7", "kg", "2015-06-01"],
    ["29463-7", "g", "2016-06-01"],
  ],
  "t-b_03": [],
  "t-bx04": [
    ["4548-4", "%", "2005-06-01"],
    ["4548-4", "%", "2006-06-01"],
    ["4548-4", "%", "2007-06-01"],
    ["4548-4", "%", "2008-06-01"],
  ],
  "t-cc05": [
    ["2093-3", "mg/dL", "2020-06-01"],
    ["2085-9", "mg/dL", "2020-06-02"],
    ["2571-8", "mg/dL", "2020-06-03"],
  ],
};

const query = (overrides: Partial<SubjectQuery>): SubjectQuery => ({
  q: "",
  sort: "observations",
  dir: "desc",
  page: 1,
  ...overrides,
});

describe.skipIf(!runLive)("Data page cohort queries (RUN_LIVE=1)", () => {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  const clear = async () => {
    const refs = [...Object.keys(READINGS), "t-zz09", "t-other"];
    await db.observation.deleteMany({ where: { subjectRef: { in: refs } } });
    await db.bundle.deleteMany({
      where: { sha: { in: refs.map((ref) => `test-${ref}`) } },
    });
    await db.subject.deleteMany({ where: { subjectRef: { in: refs } } });
  };

  const seed = async (
    ref: string,
    cohortId: string,
    isSynthetic: boolean,
    readings: readonly Reading[],
  ) => {
    await db.subject.create({ data: { subjectRef: ref, cohortId, isSynthetic } });
    await db.bundle.create({
      data: { sha: `test-${ref}`, cohortId, syntheaVersion: "v4.0.0" },
    });
    await db.observation.createMany({
      data: readings.map(([loinc, unit, iso], index) => ({
        subjectRef: ref,
        bundleSha: `test-${ref}`,
        fhirId: `obs-${index}`,
        source: "synthea",
        loinc,
        display: `code ${loinc}`,
        value: 1 + index,
        unitUcum: unit,
        effectiveAt: new Date(`${iso}T12:00:00Z`),
      })),
    });
  };

  beforeAll(async () => {
    const existing = await db.subject.count({ where: { cohortId: COHORT } });
    if (existing > 0) {
      throw new Error(
        `${COHORT} already has ${existing} subjects; use a throwaway database`,
      );
    }
    for (const [ref, readings] of Object.entries(READINGS)) {
      await seed(ref, COHORT, true, readings);
    }
    // Neither may ever show: not synthetic, and a cohort off the allowlist.
    await seed("t-zz09", COHORT, false, [["4548-4", "%", "2001-06-01"]]);
    await seed("t-other", OTHER_COHORT, true, [["4548-4", "%", "2001-06-01"]]);
  });

  afterAll(async () => {
    await clear();
    await db.$disconnect();
  });

  const refs = async (overrides: Partial<SubjectQuery>, perPage = 25) =>
    (await readSubjectPage(db, COHORT, query(overrides), perPage)).rows.map(
      (row) => row.ref,
    );

  test("the default page: most observations first, with counts and days", async () => {
    expect(await readSubjectPage(db, COHORT, query({}))).toEqual({
      rows: [
        {
          ref: "t-aa01",
          observations: 5,
          codes: 2,
          firstDay: "2010-06-01",
          lastDay: "2014-06-01",
        },
        {
          ref: "t-bx04",
          observations: 4,
          codes: 1,
          firstDay: "2005-06-01",
          lastDay: "2008-06-01",
        },
        {
          ref: "t-cc05",
          observations: 3,
          codes: 3,
          firstDay: "2020-06-01",
          lastDay: "2020-06-03",
        },
        {
          ref: "t-ab02",
          observations: 2,
          codes: 1,
          firstDay: "2015-06-01",
          lastDay: "2016-06-01",
        },
        { ref: "t-b_03", observations: 0, codes: 0, firstDay: null, lastDay: null },
      ],
      matching: 5,
      total: 5,
      page: 1,
      pages: 1,
    });
  });

  test("every sort column in both directions; ties break by ref, no days last", async () => {
    expect(await refs({ sort: "observations", dir: "asc" })).toEqual([
      "t-b_03",
      "t-ab02",
      "t-cc05",
      "t-bx04",
      "t-aa01",
    ]);
    expect(await refs({ sort: "codes", dir: "asc" })).toEqual([
      "t-b_03",
      "t-ab02",
      "t-bx04",
      "t-aa01",
      "t-cc05",
    ]);
    expect(await refs({ sort: "codes", dir: "desc" })).toEqual([
      "t-cc05",
      "t-aa01",
      "t-ab02",
      "t-bx04",
      "t-b_03",
    ]);
    expect(await refs({ sort: "first", dir: "asc" })).toEqual([
      "t-bx04",
      "t-aa01",
      "t-ab02",
      "t-cc05",
      "t-b_03",
    ]);
    expect(await refs({ sort: "first", dir: "desc" })).toEqual([
      "t-cc05",
      "t-ab02",
      "t-aa01",
      "t-bx04",
      "t-b_03",
    ]);
    expect(await refs({ sort: "last", dir: "asc" })).toEqual([
      "t-bx04",
      "t-aa01",
      "t-ab02",
      "t-cc05",
      "t-b_03",
    ]);
    expect(await refs({ sort: "ref", dir: "asc" })).toEqual([
      "t-aa01",
      "t-ab02",
      "t-b_03",
      "t-bx04",
      "t-cc05",
    ]);
    expect(await refs({ sort: "ref", dir: "desc" })).toEqual([
      "t-cc05",
      "t-bx04",
      "t-b_03",
      "t-ab02",
      "t-aa01",
    ]);
  });

  test("the ref sort reads the same counts as the aggregate sorts", async () => {
    const byRef = await readSubjectPage(db, COHORT, query({ sort: "ref", dir: "asc" }));
    const byCount = await readSubjectPage(db, COHORT, query({}));
    expect(byRef.rows.toSorted((a, b) => a.ref.localeCompare(b.ref))).toEqual(
      byCount.rows.toSorted((a, b) => a.ref.localeCompare(b.ref)),
    );
  });

  test("LIMIT and OFFSET: a middle page, and a page past the end held at the last", async () => {
    const middle = await readSubjectPage(db, COHORT, query({ page: 2 }), 2);
    expect([middle.rows.map((row) => row.ref), middle.page, middle.pages]).toEqual([
      ["t-cc05", "t-ab02"],
      2,
      3,
    ]);
    const past = await readSubjectPage(
      db,
      COHORT,
      query({ sort: "ref", dir: "asc", page: 9 }),
      2,
    );
    expect([past.rows.map((row) => row.ref), past.page, past.pages]).toEqual([
      ["t-cc05"],
      3,
      3,
    ]);
  });

  test("search is a case-insensitive prefix, and wildcards match themselves", async () => {
    const found = await readSubjectPage(db, COHORT, query({ q: "T-A" }));
    expect([found.rows.map((row) => row.ref), found.matching, found.total]).toEqual([
      ["t-aa01", "t-ab02"],
      2,
      5,
    ]);
    expect(await refs({ q: "t-b_" })).toEqual(["t-b_03"]);
    expect(await refs({ q: "t-b_", sort: "ref" })).toEqual(["t-b_03"]);
    expect(await refs({ q: "t-b", sort: "observations", dir: "desc" })).toEqual([
      "t-bx04",
      "t-b_03",
    ]);
    expect(await refs({ q: "a" })).toEqual([]);
    expect(await readSubjectPage(db, COHORT, query({ q: "t-%" }))).toEqual({
      rows: [],
      matching: 0,
      total: 5,
      page: 1,
      pages: 1,
    });
  });

  test("a cohort off the allowlist reads nothing", async () => {
    expect(await readSubjectPage(db, OTHER_COHORT, query({}))).toEqual({
      rows: [],
      matching: 0,
      total: 0,
      page: 1,
      pages: 1,
    });
  });

  test("the overview: per code and unit, and per code, from one statement", async () => {
    const aggregates = await readCohortAggregates(db, COHORT);
    const codeUnits = aggregates.codeUnits
      .map((row) => [row.loinc, row.unit, row.rows, row.subjects])
      .toSorted((a, b) => String(a[0] + a[1]).localeCompare(String(b[0] + b[1])));
    expect(codeUnits).toEqual([
      ["2085-9", "mg/dL", 1, 1],
      ["2093-3", "mg/dL", 1, 1],
      ["2571-8", "mg/dL", 1, 1],
      ["29463-7", "g", 1, 1],
      ["29463-7", "kg", 3, 2],
      ["4548-4", "%", 7, 2],
    ]);
    expect(
      aggregates.codeSubjects.toSorted((a, b) => a.loinc.localeCompare(b.loinc)),
    ).toEqual([
      { loinc: "2085-9", subjects: 1 },
      { loinc: "2093-3", subjects: 1 },
      { loinc: "2571-8", subjects: 1 },
      { loinc: "29463-7", subjects: 2 },
      { loinc: "4548-4", subjects: 2 },
    ]);
    expect(aggregates.subjects).toBe(5);
    expect(aggregates.nonNumeric).toBe(0);
    expect(aggregates.subjectFacts).toEqual([
      { sex: null, birthYear: null, deathYear: null, subjects: 5 },
    ]);
    expect(
      aggregates.years.toSorted((a, b) => a.year - b.year).map((y) => y.year),
    ).toEqual([2005, 2006, 2007, 2008, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2020]);
  });
});
