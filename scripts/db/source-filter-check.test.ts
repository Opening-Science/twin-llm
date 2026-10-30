import { describe, expect, test } from "bun:test";

import { checkSourceRows, type SourceExpectation } from "./source-filter-check";

const knowledge: SourceExpectation = {
  source: "opentwin-knowledge",
  isProbeId: (id) => ["kn-1", "kn-2", "kn-3"].includes(id),
  min: 1,
  max: 3,
};

const row = (id: string, source = "opentwin-knowledge") => ({ id, source });

describe("checkSourceRows", () => {
  test("passes all three probe rows", () => {
    expect(
      checkSourceRows([row("kn-1"), row("kn-2"), row("kn-3")], knowledge),
    ).toBeNull();
  });

  test("passes when the approximate index reaches only some probe rows", () => {
    expect(checkSourceRows([row("kn-1"), row("kn-2")], knowledge)).toBeNull();
  });

  test("fails on an empty result", () => {
    expect(checkSourceRows([], knowledge)).toContain("expected 1 to 3 rows");
  });

  test("fails when a row of another source leaks in", () => {
    expect(checkSourceRows([row("kn-1"), row("gl-1", "guideline")], knowledge)).toContain(
      'rows from ["guideline"]',
    );
  });

  test("fails on an id outside the probe", () => {
    expect(checkSourceRows([row("kn-1"), row("kn-9")], knowledge)).toContain(
      "id outside the probe",
    );
  });

  test("fails on a duplicate id", () => {
    expect(checkSourceRows([row("kn-1"), row("kn-1")], knowledge)).toContain(
      "duplicate id",
    );
  });

  test("fails outside the row range", () => {
    const exact = { ...knowledge, min: 3, max: 3 };
    expect(checkSourceRows([row("kn-1"), row("kn-2")], exact)).toContain(
      "expected 3 to 3 rows",
    );
  });
});
