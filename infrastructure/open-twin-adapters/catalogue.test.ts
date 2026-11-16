import { describe, expect, test } from "bun:test";

import { createMeasurementCatalogue } from "@open-twin/aggregate";
import { GOOGLE_HEALTH_MEASUREMENTS } from "@open-twin/provider-google-health";
import { OURA_MEASUREMENTS } from "@open-twin/provider-oura";
import { WHOOP_MEASUREMENTS } from "@open-twin/provider-whoop";

import { SOURCE_MEASURES } from "@/infrastructure/wearable-source-rules";

/**
 * The source rules (#464, docs/wearable-sources.md) compare four measures
 * across Oura, WHOOP and Google Health. open-twin's measurement catalogue
 * says which connector declares each shared key. This pins what it says at
 * the current pin, so a sync that changes it fails here and the rules are
 * read against it again.
 */
const catalogue = createMeasurementCatalogue([
  OURA_MEASUREMENTS,
  WHOOP_MEASUREMENTS,
  GOOGLE_HEALTH_MEASUREMENTS,
]);

const sourcesOf = (key: string): readonly string[] =>
  catalogue.entries
    .find((entry) => entry.key === key)
    ?.sources.map((source) => source.connector) ?? [];

describe("open-twin measurement catalogue against the source rules", () => {
  test("registers the three connectors", () => {
    expect(catalogue.connectors.map((c) => c.connector)).toEqual([
      "oura",
      "whoop",
      "google-health",
    ]);
  });

  test("no compared measure is a shared key: each is declared by one connector or none", () => {
    expect(Object.fromEntries(SOURCE_MEASURES.map((m) => [m, sourcesOf(m)]))).toEqual({
      "heart-rate-variability": [],
      "resting-heart-rate": ["google-health"],
      "oxygen-saturation": ["google-health"],
      "step-count": ["google-health"],
    });
  });

  test("Oura and WHOOP declare the compared readings under their own keys", () => {
    expect(
      [
        "oura:sleep.average-hrv",
        "daily-step-count",
        "whoop:recovery.hrv-rmssd",
        "whoop:recovery.resting-heart-rate",
        "whoop:recovery.spo2-percentage",
      ].map((key) => [key, sourcesOf(key)]),
    ).toEqual([
      ["oura:sleep.average-hrv", ["oura"]],
      ["daily-step-count", ["oura"]],
      ["whoop:recovery.hrv-rmssd", ["whoop"]],
      ["whoop:recovery.resting-heart-rate", ["whoop"]],
      ["whoop:recovery.spo2-percentage", ["whoop"]],
    ]);
  });
});
