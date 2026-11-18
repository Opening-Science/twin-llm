import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { sexAgeSplit } from "./sex-age-split";
import { SexAgeTable } from "./sex-age-table";

const split = sexAgeSplit(
  [
    { sex: "female", birthYear: 1970, deathYear: null, subjects: 3 },
    { sex: "male", birthYear: 1960, deathYear: null, subjects: 2 },
  ],
  2025,
);

const tableClass = (html: string): string =>
  /<table class="([^"]*)"/.exec(html)?.[1] ?? "";

describe("SexAgeTable", () => {
  test("is as wide as its columns, so a phone shows Female, Male and All", () => {
    const html = renderToStaticMarkup(createElement(SexAgeTable, { split }));
    expect(html).toContain(">Male<");
    // A fixed minimum (min-w-md is 448 px) pushed Male and All off a 390 px screen.
    expect(tableClass(html).split(" ")).toContain("min-w-max");
    expect(tableClass(html)).not.toMatch(/min-w-(xs|sm|md|lg|xl|\dxl)\b/);
  });
});
