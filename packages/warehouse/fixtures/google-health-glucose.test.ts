import { expect, test } from "bun:test";

import { buildBundleFromResponses } from "@open-twin/provider-google-health";
import type { Bundle, Patient } from "fhir/r4";
import type { health_v4 } from "googleapis";

import FIXTURE from "./google-health-glucose.json";

/**
 * `google-health-glucose.json`: a made-up Synthea subject with glucose
 * readings in Google Health's shape (`dataPoints.list`), built by open-twin's
 * Google Health mapper. Three readings from a continuous monitor (specimen
 * INTERSTITIAL_FLUID) at 07:00, 07:05 and 07:10 UTC on 16 Nov 2026, 95, 101
 * and 118 mg/dL, and one finger prick (CAPILLARY_BLOOD) at 07:05, 104 mg/dL.
 * No real wearer or record id. Stored as JSON so the warehouse never imports a
 * connector; this test builds it again and fails when the mapper changes.
 */

const SUBJECT = "c1000000-0000-4000-8000-000000000001";
const DAY = "2026-11-16";

/** Each point has its own made-up `name`, as Google sends one, so two readings in one minute keep two ids. */
const glucose = (
  point: number,
  time: string,
  value: number,
  specimen: string,
): health_v4.Schema$DataPoint => ({
  name: `users/synthetic/dataTypes/blood-glucose/dataPoints/${point}`,
  dataSource: { recordingMethod: "AUTO_DETECTED", platform: "FITBIT" },
  bloodGlucose: {
    sampleTime: { physicalTime: `${DAY}T${time}:00Z`, utcOffset: "0s" },
    bloodGlucoseMilligramsPerDeciliter: value,
    specimen,
  },
});

const RESPONSES: health_v4.Schema$ListDataPointsResponse[] = [
  {
    dataPoints: [
      glucose(1, "07:00", 95, "INTERSTITIAL_FLUID"),
      glucose(2, "07:05", 101, "INTERSTITIAL_FLUID"),
      glucose(3, "07:05", 104, "CAPILLARY_BLOOD"),
      glucose(4, "07:10", 118, "INTERSTITIAL_FLUID"),
    ],
  },
];

const PATIENT: Patient = {
  resourceType: "Patient",
  id: SUBJECT,
  identifier: [{ system: "https://github.com/synthetichealth/synthea", value: SUBJECT }],
  gender: "female",
  birthDate: "1980-04-02",
};

/** The Google Health observations under a Synthea Patient, as the warehouse ingests a bundle. */
const syntheticCgmBundle = (): Bundle => {
  const google = buildBundleFromResponses(RESPONSES, {
    subject: { reference: `urn:uuid:${SUBJECT}` },
    subjectKey: SUBJECT,
    timestamp: `${DAY}T23:00:00Z`,
  }).bundle;
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      { fullUrl: `urn:uuid:${SUBJECT}`, resource: PATIENT },
      ...(google.entry ?? []),
    ],
  };
};

test("google-health-glucose.json is what open-twin's Google Health mapper builds", () => {
  expect(FIXTURE).toEqual(JSON.parse(JSON.stringify(syntheticCgmBundle())));
});
