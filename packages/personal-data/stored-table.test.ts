import { describe, expect, test } from "bun:test";

import { storedColumns, storedRows } from "./stored-table";

/** Made-up stored JSON, as `save` writes it and as a damaged row might read. */

describe("storedColumns", () => {
  test("reads the stored list in order", () => {
    expect(
      storedColumns([
        { name: "id", type: "text", missing: 0 },
        { name: "score", type: "number", missing: 2 },
      ]),
    ).toEqual([
      { name: "id", type: "text", missing: 0 },
      { name: "score", type: "number", missing: 2 },
    ]);
  });

  test("one malformed entry empties the list rather than shifting columns", () => {
    expect(
      storedColumns([
        { name: "id", type: "text", missing: 0 },
        { name: 3, type: "text" },
        { name: "score", type: "number", missing: 0 },
      ]),
    ).toEqual([]);
    expect(storedColumns([{ name: "id", type: "blob", missing: 0 }])).toEqual([]);
    expect(storedColumns({ name: "id" })).toEqual([]);
    expect(storedColumns(null)).toEqual([]);
  });
});

describe("storedRows", () => {
  test("numbers and text pass; anything else is a missing cell", () => {
    expect(
      storedRows([["p01", 12.5, null], ["p02", true, { a: 1 }], "not a row"]),
    ).toEqual([["p01", 12.5, null], ["p02", null, null], []]);
    expect(storedRows("nope")).toEqual([]);
  });
});
