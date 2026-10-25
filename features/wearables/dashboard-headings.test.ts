import { describe, expect, test } from "bun:test";

import {
  heroEyebrow,
  heroHeadline,
  sectionHeading,
  sectionScorePrefix,
} from "./dashboard-headings";
import type { Metric } from "./metric-utils";

const metric = (key: string, value: number, date: string): Metric => ({
  key: `${key}.${date}`,
  label: key,
  value,
  date,
});

const OURA: readonly Metric[] = [
  metric("readiness.score", 88, "2026-01-02"),
  metric("sleep.score", 72, "2026-01-02"),
];

const WHOOP: readonly Metric[] = [
  metric("whoop.recovery.score", 64, "2026-01-02"),
  metric("whoop.cycle.strain", 11.5, "2026-01-01"),
  metric("whoop.cycle.strain", 14.2, "2026-01-02"),
  metric("whoop.sleep.performance", 88, "2026-01-01"),
];

const GOOGLE: readonly Metric[] = [
  metric("google.steps", 8432, "2026-01-02"),
  metric("google.daily-resting-heart-rate", 58, "2026-01-02"),
];

describe("heroEyebrow", () => {
  test("names each source, Google Health included", () => {
    expect(heroEyebrow("oura", "2026-01-01", "2026-01-14")).toBe(
      "Oura · 1 Jan 2026 → 14 Jan 2026",
    );
    expect(heroEyebrow("whoop", "2026-01-01", "2026-01-14")).toBe(
      "Whoop · 1 Jan 2026 → 14 Jan 2026",
    );
    expect(heroEyebrow("google-health", "2026-01-01", "2026-01-14")).toBe(
      "Google Health · 1 Jan 2026 → 14 Jan 2026",
    );
  });
});

describe("heroHeadline", () => {
  test("bands Oura readiness and sleep scores", () => {
    expect(heroHeadline("oura", OURA)).toBe("Optimal readiness · solid sleep");
  });

  test("bands Whoop recovery and sleep performance", () => {
    expect(heroHeadline("whoop", WHOOP)).toBe("Fair recovery · optimal sleep");
  });

  test("gives Google Health values, never a score band", () => {
    expect(heroHeadline("google-health", GOOGLE)).toBe("8,432 steps · 58 bpm resting");
  });

  test("with no readings each source says so", () => {
    expect(heroHeadline("oura", [])).toBe("No readiness or sleep score");
    expect(heroHeadline("whoop", [])).toBe("No recovery or sleep score");
    expect(heroHeadline("google-health", [])).toBe("No steps or resting heart rate");
  });

  test("a missing half is dropped, not dashed", () => {
    expect(heroHeadline("google-health", GOOGLE.slice(0, 1))).toBe("8,432 steps");
    expect(heroHeadline("google-health", GOOGLE.slice(1))).toBe("58 bpm resting");
    expect(heroHeadline("oura", OURA.slice(1))).toBe("Solid sleep");
    expect(heroHeadline("whoop", WHOOP.slice(0, 1))).toBe("Fair recovery");
  });
});

describe("sectionHeading", () => {
  test("Whoop strain shows the latest value, not a 0–100 band", () => {
    expect(sectionHeading("whoop", "Strain", WHOOP)).toBe("Strain · 14.2");
  });

  test("0–100 scores keep their band", () => {
    expect(sectionHeading("whoop", "Recovery", WHOOP)).toBe("Fair · 64");
    expect(sectionHeading("whoop", "Sleep", WHOOP)).toBe("Optimal · 88%");
    expect(sectionHeading("oura", "Readiness", OURA)).toBe("Optimal · 88");
  });

  test("a section with no score or no reading falls back to its title", () => {
    expect(sectionHeading("google-health", "Activity", GOOGLE)).toBe("Activity");
    expect(sectionHeading("oura", "Activity", OURA)).toBe("Activity");
    expect(sectionHeading("oura", "Personal", OURA)).toBe("Personal");
  });

  test("score prefixes per source", () => {
    expect(sectionScorePrefix("whoop", "Strain")).toBe("whoop.cycle.strain.");
    expect(sectionScorePrefix("oura", "Sleep")).toBe("sleep.score.");
    expect(sectionScorePrefix("google-health", "Sleep & SpO2")).toBeNull();
  });
});
