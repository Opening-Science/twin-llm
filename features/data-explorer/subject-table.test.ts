import { describe, expect, test } from "bun:test";

import {
  escapeLike,
  pageWindow,
  parseSubjectQuery,
  subjectQueryString,
} from "./subject-table";

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

describe("pageWindow", () => {
  test("cuts pages and holds a page past the end at the last one", () => {
    expect(pageWindow(1, 4, 3)).toEqual({ page: 1, pages: 2, skip: 0, take: 3 });
    expect(pageWindow(9, 4, 3)).toEqual({ page: 2, pages: 2, skip: 3, take: 3 });
  });

  test("no match is one empty page", () => {
    expect(pageWindow(3, 0, 25)).toEqual({ page: 1, pages: 1, skip: 0, take: 25 });
  });
});

describe("escapeLike", () => {
  test("escapes the LIKE wildcards and the escape character", () => {
    expect(escapeLike("ab-12")).toBe("ab-12");
    expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
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
