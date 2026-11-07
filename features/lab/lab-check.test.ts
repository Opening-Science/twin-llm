import { describe, expect, test } from "bun:test";

import {
  checkState,
  type LabCheck,
  plural,
  shortHash,
  splitCode,
  unavailableCheck,
  unknownReason,
  withState,
} from "./lab-check";

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
      reason: "The check could not run just now.",
      summary: "This check could not run just now. Reload the page to try again.",
      evidence: [],
    });
  });
});

describe("an Unknown says why (#483)", () => {
  test("checkState keeps the reason only for Unknown", () => {
    expect(checkState("unknown", "Why.")).toEqual({ status: "unknown", reason: "Why." });
    expect(checkState("ok", "Why.")).toEqual({ status: "ok" });
    expect(checkState("not-ok", "Why.")).toEqual({ status: "not-ok" });
  });
  test("unknownReason is null unless Unknown", () => {
    expect(unknownReason({ status: "unknown", reason: "Why." })).toBe("Why.");
    expect(unknownReason({ status: "ok" })).toBeNull();
  });
  test("withState drops a reason the check had before", () => {
    const before: LabCheck = {
      id: "x",
      title: "X",
      howTo: "true",
      status: "unknown",
      reason: "Why.",
      summary: "S.",
      evidence: [],
    };
    const after = withState(before, { status: "not-ok" });
    expect(after.status).toBe("not-ok");
    expect("reason" in after).toBe(false);
    expect(after.summary).toBe("S.");
  });
});
