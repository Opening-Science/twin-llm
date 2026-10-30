import { describe, expect, test } from "bun:test";

import { plural, shortHash, splitCode, unavailableCheck } from "./lab-check";

describe("shortHash", () => {
  test("keeps the first characters and drops an sha256: prefix", () => {
    expect(shortHash("sha256:abcdef0123456789abcdef")).toBe("abcdef012345");
    expect(shortHash("abcdef0123456789", 4)).toBe("abcd");
  });
  test("shows a dash for nothing", () => {
    expect(shortHash(null)).toBe("—");
    expect(shortHash("")).toBe("—");
  });
});

describe("plural", () => {
  test("one and many, grouped", () => {
    expect(plural(1, "row")).toBe("1 row");
    expect(plural(0, "row")).toBe("0 rows");
    expect(plural(1174, "component")).toBe("1,174 components");
  });
});

describe("splitCode", () => {
  test("marks the parts between backticks as code", () => {
    expect(splitCode("Run `bun run sbom` and reload.")).toEqual([
      { code: false, text: "Run " },
      { code: true, text: "bun run sbom" },
      { code: false, text: " and reload." },
    ]);
  });
  test("plain text stays one part", () => {
    expect(splitCode("No code here.")).toEqual([{ code: false, text: "No code here." }]);
  });
});

describe("unavailableCheck", () => {
  test("is unknown with a plain sentence and no evidence", () => {
    expect(unavailableCheck({ id: "x", title: "X", howTo: "true" })).toEqual({
      id: "x",
      title: "X",
      howTo: "true",
      status: "unknown",
      summary: "This check could not run just now. Reload the page to try again.",
      evidence: [],
    });
  });
});
