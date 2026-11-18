/**
 * A synthetic scan through warehouse ingest into a real Postgres: the
 * subject's Synthea record first, then its scan bundle, then the scan again.
 * Needs a throwaway, migrated DATABASE_URL; the test writes one made-up
 * subject into cohort `synthea-v4-seed1098`, refuses to start if that cohort
 * already has subjects there, and deletes its rows at the end.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway> bun test scripts/synthetic-scans/ingest.live.test.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient } from "@/generated/prisma/client";
import { moduleMocker } from "@/tests/support/mock-module";

import { syntheaPatientOf } from "../synthetic-wearables/bundle";
import { syntheticScanBundle } from "./bundle";
import { syntheticScanOf } from "./scan";

const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const databaseUrl = String(Reflect.get(process.env, "DATABASE_URL") ?? "");

// ingestBundle reads the app's database(), which wants the app's whole
// environment; here it gets this test's own client instead, as the other
// live tests use, so only DATABASE_URL is needed.
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});
const mockModuleForFile = moduleMocker({ mock, afterAll });
await mockModuleForFile("@/infrastructure/database", { database: () => db });
const { ingestBundle } = await import("@/packages/warehouse/ingest-bundle");

const COHORT = "synthea-v4-seed1098";
const OPTIONS = { cohortId: COHORT, syntheaVersion: "v4.0.0" };

/** patient-2 of the trimmed fixtures under a test-only id, so it meets no stored subject. */
const FIXTURE_ID = "4f083ce3-f12b-bb4b-7353-e17f0cd55b0a";
const TEST_ID = "0f0f0f0f-5ca1-4e00-8000-00000000c0de";
const SYNTHEA_BUNDLE: unknown = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../../tests/fixtures/synthea/patient-2.json"),
    "utf8",
  ).replaceAll(FIXTURE_ID, TEST_ID),
);

describe.skipIf(!runLive)("synthetic scans into the warehouse (RUN_LIVE=1)", () => {
  const clear = async () => {
    await db.observation.deleteMany({ where: { subjectRef: TEST_ID } });
    await db.observationNonNumeric.deleteMany({ where: { subjectRef: TEST_ID } });
    await db.bundle.deleteMany({ where: { cohortId: COHORT } });
    await db.subject.deleteMany({ where: { subjectRef: TEST_ID } });
  };

  beforeAll(async () => {
    const existing = await db.subject.count({ where: { cohortId: COHORT } });
    if (existing > 0) {
      throw new Error(
        `${COHORT} already has ${existing} subjects; use a throwaway database`,
      );
    }
  });

  afterAll(async () => {
    await clear();
    await db.$disconnect();
  });

  test("the scan lands on the same subject, beside its Synthea rows, in SI units", async () => {
    const record = await ingestBundle(SYNTHEA_BUNDLE, OPTIONS);
    expect(record.rejected).toBeUndefined();

    const patient = syntheaPatientOf(SYNTHEA_BUNDLE)!;
    const scan = syntheticScanBundle(patient, syntheticScanOf(SYNTHEA_BUNDLE)!);
    const report = await ingestBundle(scan, OPTIONS);
    expect(report.rejected).toBeUndefined();
    expect(report.inserted).toBe(3);
    expect(report.nonNumeric).toBe(0);

    const rows = await db.observation.findMany({
      where: { subjectRef: TEST_ID, loinc: { startsWith: "body." } },
      orderBy: { loinc: "asc" },
    });
    expect(
      rows.map((row) => [row.loinc, Number(row.value), row.unitUcum, row.source]),
    ).toEqual([
      ["body.bmi", 27.72, "kg/m2", "synthea"],
      ["body.height", 1.753, "m", "synthea"],
      ["body.mass", 85.2, "kg", "synthea"],
    ]);
    for (const row of rows) {
      expect(row.effectiveAt.toISOString()).toBe("2017-02-11T03:29:26.000Z");
    }

    // Synthea's own height is still there, in centimetres, under its LOINC code.
    const height = await db.observation.findFirst({
      where: { subjectRef: TEST_ID, loinc: "8302-2" },
    });
    expect([Number(height?.value), height?.unitUcum]).toEqual([175.3, "cm"]);

    const subject = await db.subject.findUnique({ where: { subjectRef: TEST_ID } });
    expect(subject).toMatchObject({ cohortId: COHORT, isSynthetic: true });
  });

  test("the same scan again is recognised and writes nothing", async () => {
    const patient = syntheaPatientOf(SYNTHEA_BUNDLE)!;
    const scan = syntheticScanBundle(patient, syntheticScanOf(SYNTHEA_BUNDLE)!);
    const before = await db.observation.count({ where: { subjectRef: TEST_ID } });
    const again = await ingestBundle(scan, OPTIONS);
    expect(again.alreadyIngested).toBe(true);
    expect(again.inserted).toBe(0);
    expect(await db.observation.count({ where: { subjectRef: TEST_ID } })).toBe(before);
  });
});
