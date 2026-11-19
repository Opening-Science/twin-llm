import { describe, expect, test } from "bun:test";

import {
  APPROVED_FOR_RECORDED,
  decide,
  glucosePast,
  glucoseThresholdRule,
  HEART_NOT_JUDGED,
  heartStillRule,
  STATUS_WORDS,
} from "./status-rules";

const OUTCOME = {
  status: "worth_a_look",
  evidence: ["hr-1500"],
  reason: "Up to 110 /min.",
} as const;

describe("decide", () => {
  test("a demonstration shows the rule's outcome, in words", () => {
    expect(decide("synthetic_demo", heartStillRule(), OUTCOME)).toEqual({
      status: "worth_a_look",
      words: "Worth a look",
      rule: heartStillRule(),
      evidence: ["hr-1500"],
      reason: "Up to 110 /min.",
    });
  });

  test("recorded data is not classified by a rule that is not approved, and says so", () => {
    expect(APPROVED_FOR_RECORDED).toEqual([]);
    const result = decide("recorded", HEART_NOT_JUDGED, { ...OUTCOME, status: "usual" });
    expect(result.status).toBe("not_classified");
    expect(result.words).toBe("Not classified");
    expect(result.reason).toContain("synthetic demonstrations only");
    expect(result.evidence).toEqual(["hr-1500"]);
  });

  test("not enough data stands on recorded data too: it judges nothing", () => {
    const result = decide("recorded", HEART_NOT_JUDGED, {
      status: "insufficient_data",
      evidence: [],
      reason: "No heart rate before the run to recover to.",
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.words).toBe("Not enough data");
  });

  test("every status has words, so none rests on colour alone", () => {
    expect(Object.values(STATUS_WORDS)).toEqual([
      "Usual",
      "Notable",
      "Worth a look",
      "Not enough data",
      "Not classified",
    ]);
  });
});

describe("thresholds", () => {
  test("they come from day-thresholds.json and say they are placeholders", () => {
    expect(heartStillRule().text).toContain("100 /min");
    expect(glucoseThresholdRule("without_diabetes").text).toContain("140 mg/dL");
    expect(glucoseThresholdRule("with_diabetes").text).toContain("70–180 mg/dL");
    expect(glucoseThresholdRule("with_diabetes").basis).toBe("placeholder_threshold");
  });

  test("glucose past the threshold, by profile", () => {
    expect(glucosePast(141, "without_diabetes")).toBe("above");
    expect(glucosePast(60, "without_diabetes")).toBeNull();
    expect(glucosePast(60, "with_diabetes")).toBe("below");
    expect(glucosePast(181, "with_diabetes")).toBe("above");
    expect(glucosePast(140, "without_diabetes")).toBeNull();
  });
});
