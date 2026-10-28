import { describe, expect, test } from "bun:test";

import type { TwinBodySpec } from "@/infrastructure/chat-view";

import {
  twinBodyCaption,
  twinBodyEmptyText,
  twinBodyFocus,
  twinBodyLines,
} from "./twin-body-text";

const spec: TwinBodySpec = {
  focus: "metabolic",
  label: "Metabolic system",
  body: "demo",
  subject: "synthetic-subject",
  window: { start: "2026-01-01", end: "2026-03-31" },
  unit: null,
  organs: [
    {
      organ: "liver",
      label: "Liver",
      position: "above",
      marker: "Gamma-GT (GGT)",
      loinc: "2324-2",
    },
    {
      organ: "pancreas",
      label: "Pancreas",
      position: "within",
      marker: "HbA1c",
      loinc: "4548-4",
    },
  ],
  n: 7,
};

describe("twinBodyLines", () => {
  test("one line per organ, in words", () => {
    expect(twinBodyLines(spec)).toEqual([
      "Liver · Gamma-GT (GGT) · Above the published range",
      "Pancreas · HbA1c · Within the published range",
    ]);
    expect(twinBodyEmptyText(spec)).toBeNull();
  });
});

describe("twinBodyEmptyText", () => {
  test("no subject read", () => {
    expect(twinBodyEmptyText({ ...spec, subject: null, organs: [], n: 0 })).toBe(
      "No lab values were read, so no organ has a position.",
    );
  });

  test("no readings in the window", () => {
    expect(twinBodyEmptyText({ ...spec, organs: [], n: 0 })).toBe(
      "No mapped lab marker has a reading in this window.",
    );
  });

  test("readings without a fitting range", () => {
    expect(twinBodyEmptyText({ ...spec, organs: [] })).toBe(
      "No reading here has a published range that fits, so no organ has a position.",
    );
  });
});

describe("twinBodyCaption", () => {
  test("names the body and whose labs", () => {
    expect(twinBodyCaption(spec)).toBe("Demo body · labs of synthetic-subject");
    expect(twinBodyCaption({ ...spec, body: "self", subject: null })).toBe(
      "Self (scan where available)",
    );
  });
});

describe("twinBodyFocus", () => {
  test("lights the system at the organ layer", () => {
    expect(twinBodyFocus(spec)).toEqual({
      id: "metabolic",
      label: "Metabolic system",
      highlights: {
        hra: { kind: "system", ids: ["metabolic"] },
        bodyparts3d: { kind: "system", ids: ["metabolic"] },
      },
      depth: 3,
    });
  });
});
