import { describe, expect, test } from "bun:test";

import { DOCS_COPY } from "./docs-copy";

describe("DOCS_COPY", () => {
  test("every German entry differs from the English one", () => {
    for (const key of ["title", "introBefore", "introAfter", "crumb"] as const)
      expect(DOCS_COPY.de[key]).not.toBe(DOCS_COPY.en[key]);
  });
});
