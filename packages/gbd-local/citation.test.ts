import { describe, expect, test } from "bun:test";

import { parseGbdCitation } from "./citation";
import { GBD_LOCAL_CITATION } from "./constants";

describe("parseGbdCitation", () => {
  test("drops the tool's preamble and joins the citation into one line", () => {
    const file = [
      "GBD Results tool:",
      "Use the following to cite data included in this download:",
      "Global Burden of Disease Collaborative Network.",
      "Global Burden of Disease Study 2023 (GBD 2023) Results.",
      "Seattle, United States: Institute for Health Metrics and Evaluation (IHME), 2024.",
      "Available from https://vizhub.healthdata.org/gbd-results/.",
      "",
    ].join("\r\n");
    expect(parseGbdCitation(file)).toBe(GBD_LOCAL_CITATION);
  });

  test("keeps a citation without the preamble", () => {
    expect(parseGbdCitation("  Some  citation.\n")).toBe("Some citation.");
  });

  test("is null for an empty file or one with only the preamble", () => {
    expect(parseGbdCitation("")).toBeNull();
    expect(
      parseGbdCitation("GBD Results tool:\nUse the following to cite data:\n"),
    ).toBeNull();
  });
});
