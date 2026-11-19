import { describe, expect, test } from "bun:test";

import { GLOBAL_ERROR_COPY } from "./global-error-copy";

describe("GLOBAL_ERROR_COPY", () => {
  test("English keeps the page's words", () => {
    expect(GLOBAL_ERROR_COPY.en.title).toBe("TwinLLM couldn’t load");
    expect(GLOBAL_ERROR_COPY.en.reload).toBe("Reload");
  });

  test("German has every entry, none left in English, and never the error itself", () => {
    for (const key of ["title", "line", "reload"] as const) {
      expect(GLOBAL_ERROR_COPY.de[key].trim()).not.toBe("");
      expect(GLOBAL_ERROR_COPY.de[key]).not.toBe(GLOBAL_ERROR_COPY.en[key]);
    }
  });
});
