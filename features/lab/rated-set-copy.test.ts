import { describe, expect, test } from "bun:test";

import {
  exportFileName,
  noReferenceText,
  RATED_SET_COPY,
  ratePath,
} from "./rated-set-copy";
import { RATED_SETS } from "./rater-rubric";

describe("rated set copy (#304)", () => {
  test("hb keeps its line where an item has no tool value", () => {
    expect(noReferenceText("hb", "decline")).toBe(
      "No tool value for this item; it should be declined.",
    );
    expect(noReferenceText("hb", "keyed")).toBeNull();
  });

  test("v1h tells a decline from a lookup without a keyed value", () => {
    expect(noReferenceText("v1h", "decline")).toContain("should be declined");
    expect(noReferenceText("v1h", "unkeyed")).toContain("rate it on the note");
    expect(noReferenceText("v1h", "keyed")).toBeNull();
  });

  test("every set names its runs' set in its commands", () => {
    expect(
      RATED_SETS.every((set) =>
        RATED_SET_COPY[set].runCommands.every((command) =>
          command.includes(`--set ${set}`),
        ),
      ),
    ).toBe(true);
  });

  test("export names and addresses keep hb as it was", () => {
    expect(exportFileName("hb", "rater-b")).toBe("ratings-rater-b.json");
    expect(exportFileName("v1h", "rater-b")).toBe("ratings-rater-b-v1h.json");
    expect(ratePath("hb")).toBe("/lab/rate");
    expect(ratePath("hb", "rater-b")).toBe("/lab/rate?rater=rater-b");
    expect(ratePath("v1h")).toBe("/lab/rate?set=v1h");
    expect(ratePath("v1h", "rater-b")).toBe("/lab/rate?set=v1h&rater=rater-b");
  });
});
