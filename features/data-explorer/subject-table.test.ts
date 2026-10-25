import { describe, expect, test } from "bun:test";

import {
  pageSubjects,
  parseSubjectQuery,
  sortSubjects,
  subjectQueryString,
  type SubjectSummary,
} from "./subject-table";

const subject = (
  ref: string,
  observations: number,
  codes: number,
  firstDay: string | null,
  lastDay: string | null,
): SubjectSummary => ({ ref, observations, codes, firstDay, lastDay });

const ROWS = [
  subject("aa11", 120, 30, "2010-01-02", "2026-09-01"),
  subject("bb22", 900, 41, "2001-05-06", "2020-01-01"),
  subject("cc33", 0, 0, null, null),
  subject("dd44", 120, 12, "2015-07-08", "2026-10-01"),
];

describe("parseSubjectQuery", () => {
  test("defaults to most observations first, page 1", () => {
    expect(parseSubjectQuery({})).toEqual({
      q: "",
      sort: "observations",
      dir: "desc",
      page: 1,
    });
  });

  test("reads a valid sort, direction, page and trimmed search", () => {
    expect(
      parseSubjectQuery({ q: "  Ab1 ", sort: "first", dir: "desc", page: "3" }),
    ).toEqual({
      q: "Ab1",
      sort: "first",
      dir: "desc",
      page: 3,
    });
  });

  test("an unknown sort, a bad direction and a bad page fall back", () => {
    expect(parseSubjectQuery({ sort: "name", dir: "up", page: "-2" })).toEqual({
      q: "",
      sort: "observations",
      dir: "desc",
      page: 1,
    });
    expect(parseSubjectQuery({ sort: "ref", page: "1.5" })).toEqual({
      q: "",
      sort: "ref",
      dir: "asc",
      page: 1,
    });
  });

  test("the first of repeated parameters wins and long searches are cut to 64", () => {
    const query = parseSubjectQuery({ q: ["x".repeat(80), "y"], sort: ["codes", "ref"] });
    expect(query.q).toBe("x".repeat(64));
    expect(query.sort).toBe("codes");
    expect(query.dir).toBe("desc");
  });
});

describe("sortSubjects", () => {
  test("ties on a count break by ref", () => {
    expect(sortSubjects(ROWS, "observations", "desc").map((row) => row.ref)).toEqual([
      "bb22",
      "aa11",
      "dd44",
      "cc33",
    ]);
  });

  test("a subject with no days sorts last in both directions", () => {
    expect(sortSubjects(ROWS, "first", "asc").map((row) => row.ref)).toEqual([
      "bb22",
      "aa11",
      "dd44",
      "cc33",
    ]);
    expect(sortSubjects(ROWS, "last", "desc").map((row) => row.ref)).toEqual([
      "dd44",
      "aa11",
      "bb22",
      "cc33",
    ]);
  });
});

describe("pageSubjects", () => {
  test("filters by ref case-insensitively before paging", () => {
    const page = pageSubjects(ROWS, { q: "D4", sort: "ref", dir: "asc", page: 1 }, 2);
    expect(page).toEqual({ rows: [ROWS[3]!], matching: 1, page: 1, pages: 1 });
  });

  test("cuts pages and holds a page past the end at the last one", () => {
    const page = pageSubjects(ROWS, { q: "", sort: "ref", dir: "asc", page: 9 }, 3);
    expect(page.rows.map((row) => row.ref)).toEqual(["dd44"]);
    expect(page.page).toBe(2);
    expect(page.pages).toBe(2);
    expect(page.matching).toBe(4);
  });

  test("no match is one empty page", () => {
    expect(pageSubjects(ROWS, { q: "zz", sort: "ref", dir: "asc", page: 1 })).toEqual({
      rows: [],
      matching: 0,
      page: 1,
      pages: 1,
    });
  });
});

describe("subjectQueryString", () => {
  test("leaves out defaults", () => {
    expect(
      subjectQueryString("synthea-v4-seed42", {
        sort: "observations",
        dir: "desc",
        page: 1,
      }),
    ).toBe("?cohort=synthea-v4-seed42");
  });

  test("keeps search, sort, a non-default direction and the page", () => {
    expect(
      subjectQueryString("synthea-v4-seed42", {
        q: "ab",
        sort: "ref",
        dir: "desc",
        page: 2,
      }),
    ).toBe("?cohort=synthea-v4-seed42&q=ab&sort=ref&dir=desc&page=2");
  });
});
