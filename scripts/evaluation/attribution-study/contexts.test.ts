import { describe, expect, test } from "bun:test";

import {
  DEV_OPTIONS,
  FIXED_ORDER,
  generateW1,
  type W1Item,
} from "../../synthetic-wearables/w1-items";

import {
  accuracyLine,
  listedMetrics,
  ruleText,
  studyPrompt,
  SYNTHETIC_NOTE,
} from "./contexts";

const items = generateW1(DEV_OPTIONS);
const multi = items.find(
  (item) => item.stratum === "disagree" && item.listing.length === 3,
) as W1Item;

describe("studyPrompt", () => {
  test("C0 lists keys and values only: no source names, days or rule", () => {
    const { system } = studyPrompt(multi, "C0", FIXED_ORDER);
    expect(system).toContain(SYNTHETIC_NOTE);
    for (const metric of multi.metrics) expect(system).toContain(`[${metric.key}]`);
    expect(system).not.toContain("(source:");
    expect(system).not.toContain("Selection rule");
    expect(system).not.toContain("How accurate");
  });

  test("C1 adds each reading's source and day and the rule", () => {
    const { system } = studyPrompt(multi, "C1", FIXED_ORDER);
    expect(system).toMatch(
      /\(source: (Oura|WHOOP|Google Health); day: \d{1,2} \w{3} \d{4}\)/,
    );
    expect(system).toContain(ruleText(multi.rule, FIXED_ORDER, multi.measure));
    expect(system).not.toContain("How accurate");
  });

  test("C2 adds one accuracy note per listed source", () => {
    const { system } = studyPrompt(multi, "C2", FIXED_ORDER);
    expect(system).toContain("How accurate each source is");
    for (const source of multi.listing) {
      const line = accuracyLine(source, multi.measure);
      if (line !== null) expect(system).toContain(line.text);
    }
  });

  test("the user turn is the item's question", () => {
    expect(studyPrompt(multi, "C1", FIXED_ORDER).user).toBe(multi.question);
  });

  test("readings are listed source by source in the item's listing order", () => {
    const sources = listedMetrics(multi).map((metric) => metric.source);
    const firsts = [...new Set(sources)];
    expect(firsts).toEqual([...multi.listing]);
  });

  test("the rule names the order it is given, so a swap changes the prompt", () => {
    expect(
      ruleText("fixed_order", ["whoop", "oura", "google_health"], "resting-heart-rate"),
    ).toContain("WHOOP, Oura, Google Health");
    expect(ruleText("hold_back", FIXED_ORDER, "resting-heart-rate")).toContain(
      "by more than 3 bpm",
    );
    expect(ruleText("hold_back", FIXED_ORDER, "heart-rate-variability")).toContain(
      "5 ms or 10% of the higher reading",
    );
  });
});

describe("accuracyLine", () => {
  test("Oura and WHOOP have one note each, with the review's level", () => {
    expect(accuracyLine("oura", "heart-rate-variability")?.level).toBe("validated");
    expect(accuracyLine("whoop", "resting-heart-rate")?.text).toStartWith(
      "WHOOP resting heart rate (evidence:",
    );
  });

  test("Google Health says the device is not known and gives both notes", () => {
    const line = accuracyLine("google_health", "heart-rate-variability");
    expect(line?.text).toContain("the device behind a reading is not known");
    expect(line?.text).toContain("Fitbit:");
    expect(line?.text).toContain("Pixel Watch:");
  });
});
