import { describe, expect, test } from "bun:test";

import {
  attributionProvenanceLine,
  citedValueLine,
  metricDay,
  pickedSourceLine,
  provenanceLine,
  sourceOfMetricKey,
} from "./wearable-provenance";

describe("sourceOfMetricKey", () => {
  test("by stored prefix; Oura's keys carry none", () => {
    expect(sourceOfMetricKey("whoop.recovery.rhr.2026-10-15")).toBe("whoop");
    expect(sourceOfMetricKey("google.daily-resting-heart-rate.2026-10-15")).toBe(
      "google_health",
    );
    expect(sourceOfMetricKey("vitronic.height.body.2026-10-15")).toBe("bodyloop");
    expect(sourceOfMetricKey("sleep.hrv.2026-10-15")).toBe("oura");
  });
});

describe("metricDay", () => {
  test("its own date first, then the day the key ends with", () => {
    expect(metricDay({ key: "sleep.hrv.2026-10-15", date: "2026-10-14" })).toBe(
      "2026-10-14",
    );
    expect(metricDay({ key: "sleep.hrv.2026-10-15" })).toBe("2026-10-15");
  });

  test("no real day is no day", () => {
    expect(metricDay({ key: "whoop.recovery.rhr.unknown" })).toBeNull();
    expect(metricDay({ key: "personal.age" })).toBeNull();
    expect(metricDay({ key: "x.y", date: "unknown" })).toBeNull();
  });
});

describe("provenanceLine", () => {
  test("source and day in plain words", () => {
    expect(provenanceLine({ source: "whoop", day: "2026-10-15" })).toBe(
      "From WHOOP, 15 Oct 2026",
    );
    expect(provenanceLine({ source: "google_health", day: null })).toBe(
      "From Google Health",
    );
  });
});

describe("pickedSourceLine", () => {
  test("names the sources passed over and the rule", () => {
    expect(pickedSourceLine("oura", ["whoop"])).toBe(
      "WHOOP also records this; Oura comes first in a fixed order, so its reading is shown.",
    );
    expect(pickedSourceLine("oura", ["whoop", "google_health"])).toBe(
      "WHOOP and Google Health also record this; Oura comes first in a fixed order, so its reading is shown.",
    );
  });

  test("nothing to say when the chosen source was the only one", () => {
    expect(pickedSourceLine("oura", [])).toBeNull();
    expect(pickedSourceLine("oura", ["oura"])).toBeNull();
  });
});

describe("attributionProvenanceLine", () => {
  test("a cited value with its source and day", () => {
    expect(attributionProvenanceLine({ source: "oura", day: "2026-01-02" })).toBe(
      "From Oura, 2 Jan 2026",
    );
    expect(attributionProvenanceLine({ source: "bodyloop" })).toBe("From BodyLoop");
  });

  test("an answer stored before, or a source it does not know, shows nothing", () => {
    expect(attributionProvenanceLine({})).toBeNull();
    expect(attributionProvenanceLine({ source: "fitbit", day: "2026-01-02" })).toBeNull();
    expect(attributionProvenanceLine({ source: "whoop", day: "soon" })).toBe(
      "From WHOOP",
    );
  });
});

describe("citedValueLine (#545)", () => {
  const chip = { source: "oura", day: "2026-01-02" };

  test("a match names the reading's source and day", () => {
    expect(
      citedValueLine({ ...chip, valueCheck: { status: "matched", stated: "82" } }),
    ).toBe("Matches the Oura reading, 2 Jan 2026");
    expect(
      citedValueLine({
        source: "whoop",
        valueCheck: { status: "matched", stated: "52" },
      }),
    ).toBe("Matches the WHOOP reading");
    expect(citedValueLine({ valueCheck: { status: "matched", stated: "52" } })).toBe(
      "Matches the cited reading",
    );
  });

  test("a mismatch gets no source, only what the answer said", () => {
    expect(
      citedValueLine({ ...chip, valueCheck: { status: "not_matched", stated: "75" } }),
    ).toBe("Doesn't match the cited reading: the answer says 75");
    expect(citedValueLine({ ...chip, valueCheck: { status: "not_matched" } })).toBe(
      "Doesn't match the cited reading",
    );
  });

  test("no number stated, no check stored, or a check it does not know: as before", () => {
    expect(citedValueLine({ ...chip, valueCheck: { status: "unstated" } })).toBe(
      "From Oura, 2 Jan 2026",
    );
    expect(citedValueLine(chip)).toBe("From Oura, 2 Jan 2026");
    expect(citedValueLine({ ...chip, valueCheck: { status: "maybe" } })).toBe(
      "From Oura, 2 Jan 2026",
    );
    expect(citedValueLine({})).toBeNull();
  });
});
