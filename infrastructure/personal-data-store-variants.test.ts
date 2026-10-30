import { describe, expect, test } from "bun:test";

import { variantIdCellMatches } from "./personal-data-store";

describe("variantIdCellMatches", () => {
  test("an rsID as the whole ID cell or one part of a ; list, never a prefix", () => {
    expect(variantIdCellMatches("rs12")).toEqual([
      { variantId: "rs12" },
      { variantId: { startsWith: "rs12;" } },
      { variantId: { endsWith: ";rs12" } },
      { variantId: { contains: ";rs12;" } },
    ]);
  });
});
