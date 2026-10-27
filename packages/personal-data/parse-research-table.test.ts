import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { MAX_COLUMNS } from "./limits";
import { parseResearchTable } from "./parse-research-table";

const fixture = (name: string): string =>
  readFileSync(
    join(import.meta.dir, "../../tests/fixtures/personal-import", name),
    "utf8",
  );

describe("parseResearchTable", () => {
  test("infers column types and keeps missing cells as null", () => {
    const parsed = parseResearchTable(fixture("research-table.tsv"));
    expect(parsed).toEqual({
      ok: true,
      kind: "table",
      table: {
        columns: [
          { name: "participant", type: "text", missing: 0 },
          { name: "visit_date", type: "date", missing: 1 },
          { name: "score", type: "number", missing: 1 },
          { name: "group", type: "text", missing: 1 },
          { name: "comment", type: "text", missing: 0 },
        ],
        rows: [
          ["p01", "2024-01-15", 12.5, "a", "first visit"],
          ["p02", "2024-01-16", null, null, "second visit"],
          ["p03", "2024-02-01", 9, "a", 'said "fine"'],
          ["p04", null, 11.25, "b", "late"],
        ],
      },
      unmapped: [
        { where: "row 6", code: "field-count", reason: "has 4 fields; the header has 5" },
      ],
      notes: [],
    });
  });

  test("a day that does not exist makes the column text, not a date", () => {
    const parsed = parseResearchTable("id,day\n1,2024-02-28\n2,2024-02-30\n");
    expect(parsed.ok && parsed.kind === "table" ? parsed.table.columns : null).toEqual([
      { name: "id", type: "number", missing: 0 },
      { name: "day", type: "text", missing: 0 },
    ]);
  });

  test("duplicate or blank column names are refused", () => {
    expect(parseResearchTable("a,b,a\n1,2,3\n")).toEqual({
      ok: false,
      refusal: {
        code: "duplicate-column-name",
        message: 'Column names must be unique; "a" appears more than once.',
      },
    });
    expect(parseResearchTable("a,,c\n1,2,3\n")).toEqual({
      ok: false,
      refusal: {
        code: "blank-column-name",
        message: "Column 2 has no name in the header.",
      },
    });
  });

  test("more than 200 columns is refused, not cut", () => {
    const header = Array.from({ length: MAX_COLUMNS + 1 }, (_, index) => `c${index}`);
    expect(
      parseResearchTable(`${header.join(",")}\n${header.map(() => "1").join(",")}\n`),
    ).toEqual({
      ok: false,
      refusal: {
        code: "too-many-columns",
        message: "The table has 201 columns; the limit is 200.",
      },
    });
  });

  test("a file where no row fits the header asks about the separator", () => {
    expect(parseResearchTable("a\tb\tc\n1,2,3\n")).toEqual({
      ok: false,
      refusal: {
        code: "no-matching-rows",
        message:
          "No row has as many fields as the header. Check the separator (comma or tab).",
      },
    });
  });
});
