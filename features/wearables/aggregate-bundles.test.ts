import { describe, expect, test } from "bun:test";

import { SYNTHETIC_OURA_DATA } from "@/features/oura/fixtures/synthetic-sync-data";
import { SYNTHETIC_WHOOP_PAYLOAD } from "@/features/whoop/fixtures/synthetic-sync-payload";

import { aggregateWearableBundles } from "@/infrastructure/open-twin-adapters/aggregate";
import { buildOuraFhirBundle } from "@/infrastructure/open-twin-adapters/oura";
import { buildWhoopFhirBundle } from "@/infrastructure/open-twin-adapters/whoop";

const SYNTHETIC_SUBJECT = "synthetic-wearer-1";
const TIMESTAMP = "2026-01-05T00:00:00Z";
const options = { subjectKey: SYNTHETIC_SUBJECT, timestamp: TIMESTAMP };

const oura = buildOuraFhirBundle(
  SYNTHETIC_OURA_DATA,
  {
    types: ["workout", "daily_spo2", "daily_stress", "vO2_max"],
    start_date: "2026-01-01",
    end_date: "2026-01-04",
  },
  options,
);
const whoop = buildWhoopFhirBundle(SYNTHETIC_WHOOP_PAYLOAD, options);

const resourceIds = (bundle: { entry?: { resource?: { id?: string } }[] }) =>
  (bundle.entry ?? []).map((entry) => entry.resource?.id);

describe("aggregateWearableBundles", () => {
  test("one source: every resource carried through, nothing reconciled", () => {
    const { bundle, reconciliations } = aggregateWearableBundles({
      oura: null,
      whoop,
      ...options,
    });
    expect(resourceIds(bundle)).toEqual(resourceIds(whoop));
    expect(reconciliations).toEqual([]);
  });

  test("today's Oura and WHOOP bundles are refused: each connector mints its own subject", () => {
    expect(() => aggregateWearableBundles({ oura, whoop, ...options })).toThrow(
      "Cannot reconcile across 2 different subjects",
    );
  });

  test("no bundle at all is refused", () => {
    expect(() =>
      aggregateWearableBundles({ oura: null, whoop: null, ...options }),
    ).toThrow("Cannot aggregate nothing");
  });
});
