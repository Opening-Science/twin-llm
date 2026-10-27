import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, unknown>;

const store = {
  subjects: new Map<string, Row>(),
  bundles: new Map<string, Row>(),
  observations: [] as Row[],
  nonNumeric: [] as Row[],
  transactionTimeouts: [] as Array<number | undefined>,
};

const resetStore = () => {
  store.subjects.clear();
  store.bundles.clear();
  store.observations.length = 0;
  store.nonNumeric.length = 0;
  store.transactionTimeouts.length = 0;
};

const mockDb = () => ({
  bundle: {
    findUnique: async ({ where }: { where: { sha: string } }) =>
      store.bundles.get(where.sha) ?? null,
    create: async ({ data }: { data: Row }) => {
      store.bundles.set(data.sha as string, { ...data });
      return data;
    },
  },
  observation: {
    count: async ({ where }: { where: { bundleSha: string } }) =>
      store.observations.filter((row) => row.bundleSha === where.bundleSha).length,
    createMany: async ({ data }: { data: Row[] }) => {
      for (const row of data) {
        store.observations.push({ id: `obs-${store.observations.length + 1}`, ...row });
      }
      return { count: data.length };
    },
  },
  observationNonNumeric: {
    count: async ({ where }: { where: { bundleSha: string } }) =>
      store.nonNumeric.filter((row) => row.bundleSha === where.bundleSha).length,
    createMany: async ({ data }: { data: Row[] }) => {
      for (const row of data) {
        store.nonNumeric.push({ id: `nn-${store.nonNumeric.length + 1}`, ...row });
      }
      return { count: data.length };
    },
  },
  subject: {
    findUnique: async ({ where }: { where: { subjectRef: string } }) =>
      store.subjects.get(where.subjectRef) ?? null,
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { subjectRef: string };
      create: Row;
      update: Row;
    }) => {
      const existing = store.subjects.get(where.subjectRef);
      if (existing) {
        const updated = { ...existing, ...update };
        store.subjects.set(where.subjectRef, updated);
        return updated;
      }
      store.subjects.set(create.subjectRef as string, { ...create });
      return create;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const matches = [...store.subjects.values()].filter((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value),
      );
      for (const row of matches) {
        store.subjects.set(row.subjectRef as string, { ...row, ...data });
      }
      return { count: matches.length };
    },
  },
  $transaction: async (
    fn: (tx: ReturnType<typeof mockDb>) => Promise<unknown>,
    options?: { timeout?: number },
  ) => {
    store.transactionTimeouts.push(options?.timeout);
    return fn(mockDb());
  },
});

mock.module("server-only", () => ({}));
mock.module("@/infrastructure/database", () => ({
  database: () => mockDb(),
}));

const FIXTURE_DIR = join(import.meta.dir, "../../tests/fixtures/synthea");
const COHORT = "open-twin-synthea-trimmed-3";
const VERSION = "4.0.0";

const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));

const withoutEncounters = (bundle: unknown): unknown => {
  const clone = structuredClone(bundle) as {
    entry?: Array<{ resource?: { encounter?: unknown } }>;
  };
  for (const entry of clone.entry ?? []) {
    if (entry.resource) delete entry.resource.encounter;
  }
  return clone;
};

const observationsOf = (bundle: unknown) => {
  const entries =
    (bundle as { entry?: Array<{ resource?: { resourceType?: string } }> }).entry ?? [];
  return entries
    .map((entry) => entry.resource)
    .filter((resource) => resource?.resourceType === "Observation") as Array<{
    id?: string;
    code?: { coding?: Array<{ system?: string; code?: string; display?: string }> };
    valueQuantity?: { value?: number; code?: string; unit?: string };
    effectiveDateTime?: string;
  }>;
};

const loincOf = (observation: ReturnType<typeof observationsOf>[number]) =>
  observation.code?.coding?.find((item) => item.system === "http://loinc.org")?.code;

const NAMED = [
  {
    fixture: "patient-1.json",
    loinc: "79893-4",
    value: 17,
    unit: "mm[Hg]",
    effective: "2017-02-24T06:35:42+01:00",
  },
  {
    fixture: "patient-1.json",
    loinc: "72514-3",
    value: 6,
    unit: "{score}",
    effective: "2017-01-24T03:33:25+01:00",
  },
  {
    fixture: "patient-2.json",
    loinc: "8302-2",
    value: 175.3,
    unit: "cm",
    effective: "2017-02-11T04:29:26+01:00",
  },
  {
    fixture: "patient-2.json",
    loinc: "39156-5",
    value: 27.72,
    unit: "kg/m2",
    effective: "2017-02-11T04:29:26+01:00",
  },
  {
    fixture: "patient-3.json",
    loinc: "29463-7",
    value: 21.9,
    unit: "kg",
    effective: "2016-11-13T22:33:18+01:00",
  },
] as const;

const LOINC_COUNTS = {
  "patient-1.json": {
    "72514-3": 1,
    "98498-9": 1,
    "98499-7": 1,
    "79893-4": 1,
    "79892-6": 1,
  },
  "patient-2.json": {
    "8302-2": 1,
    "72514-3": 1,
    "29463-7": 1,
    "39156-5": 1,
    "59576-9": 1,
  },
  "patient-3.json": {
    "8302-2": 1,
    "72514-3": 1,
    "29463-7": 1,
    "39156-5": 1,
    "59576-9": 1,
  },
} as const;

beforeEach(() => {
  resetStore();
});

describe("Synthea fixture inventory", () => {
  for (const name of ["patient-1.json", "patient-2.json", "patient-3.json"] as const) {
    test(`${name} has one Patient and the expected LOINC counts`, () => {
      const bundle = loadFixture(name);
      const entries =
        (bundle as { entry?: Array<{ resource?: { resourceType?: string } }> }).entry ??
        [];
      expect(
        entries.filter((entry) => entry.resource?.resourceType === "Patient"),
      ).toHaveLength(1);
      const counts: Record<string, number> = {};
      for (const observation of observationsOf(bundle)) {
        const loinc = loincOf(observation);
        if (loinc) counts[loinc] = (counts[loinc] ?? 0) + 1;
      }
      expect(counts).toEqual(LOINC_COUNTS[name]);
    });
  }

  for (const named of NAMED) {
    test(`${named.fixture} ${named.loinc} is ${named.value} ${named.unit} at ${named.effective}`, () => {
      const match = observationsOf(loadFixture(named.fixture)).find(
        (observation) => loincOf(observation) === named.loinc,
      );
      expect(match?.valueQuantity).toMatchObject({
        value: named.value,
        code: named.unit,
      });
      expect(match?.effectiveDateTime).toBe(named.effective);
    });
  }
});

describe("ingestBundle at pin 24179d8", () => {
  for (const name of ["patient-1.json", "patient-2.json", "patient-3.json"] as const) {
    test(`${name} inserts 5 rows with named values and lists unresolved Encounter URNs`, async () => {
      const { ingestBundle } = await import("./ingest-bundle");
      const bundle = loadFixture(name);
      const report = await ingestBundle(bundle, {
        cohortId: COHORT,
        syntheaVersion: VERSION,
      });

      expect(report.inserted).toBe(5);
      expect(report.skipped).toBe(0);
      expect(report.rejected).toBeUndefined();
      expect(report.nonNumeric).toBe(0);
      expect(report.unresolved.length).toBeGreaterThan(0);
      expect(report.unresolved.every((urn) => urn.startsWith("urn:uuid:"))).toBe(true);
      expect(store.observations).toHaveLength(5);
      expect(store.subjects.values().next().value?.isSynthetic).toBe(true);
      expect(store.observations.every((row) => row.source === "synthea")).toBe(true);
      expect(store.observations.every((row) => typeof row.unitUcum === "string")).toBe(
        true,
      );

      for (const named of NAMED.filter((item) => item.fixture === name)) {
        const row = store.observations.find((item) => item.loinc === named.loinc);
        expect(row).toMatchObject({
          loinc: named.loinc,
          value: named.value,
          unitUcum: named.unit,
        });
        expect(row?.effectiveAt).toEqual(new Date(named.effective));
      }
    });
  }

  test("constructed patient-2 without Encounter refs inserts 5, second ingest inserts 0", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    const bundle = withoutEncounters(loadFixture("patient-2.json"));

    const first = await ingestBundle(bundle, {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });
    expect(first.rejected).toBeUndefined();
    expect(first.inserted).toBe(5);
    expect(first.skipped).toBe(0);
    expect(first.nonNumeric).toBe(0);
    expect(store.observations).toHaveLength(5);
    expect(store.subjects.values().next().value?.isSynthetic).toBe(true);
    expect(store.observations.every((row) => row.source === "synthea")).toBe(true);
    expect(store.observations.every((row) => typeof row.unitUcum === "string")).toBe(
      true,
    );

    const second = await ingestBundle(bundle, {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });
    expect(first.alreadyIngested).toBe(false);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(5);
    expect(second.alreadyIngested).toBe(true);
    expect(store.observations).toHaveLength(5);
  });

  test("a bundle missing UCUM is rejected with ot-quantity-no-code and inserts 0", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    const bundle = withoutEncounters(loadFixture("patient-2.json")) as {
      entry: Array<{ resource?: { valueQuantity?: Record<string, unknown> } }>;
    };
    const observation = bundle.entry.find((entry) => entry.resource?.valueQuantity);
    if (!observation?.resource?.valueQuantity)
      throw new Error("expected a Quantity observation");
    delete observation.resource.valueQuantity.system;
    delete observation.resource.valueQuantity.code;

    const report = await ingestBundle(bundle, {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });
    expect(report.inserted).toBe(0);
    expect(report.rejected?.reason).toBe("ot-quantity-no-code");
    expect(store.observations).toEqual([]);
    expect(store.bundles.size).toBe(0);
  });
});

describe("blood pressure components and Synthea marker", () => {
  test("bp-panel.json flattens each panel into systolic and diastolic rows", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    const report = await ingestBundle(loadFixture("bp-panel.json"), {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });

    expect(report).toEqual({
      inserted: 7,
      skipped: 0,
      unresolved: [],
      nonNumeric: 2,
      alreadyIngested: false,
    });
    expect(store.transactionTimeouts).toEqual([120_000]);
    const [panelA, panelB] = store.nonNumeric.map((row) => String(row.fhirId));
    expect(
      store.observations.map((row) => [row.fhirId, row.loinc, row.value, row.unitUcum]),
    ).toEqual([
      [`${panelA}#8462-4`, "8462-4", 82, "mm[Hg]"],
      [`${panelA}#8480-6`, "8480-6", 128, "mm[Hg]"],
      [`${panelB}#8462-4`, "8462-4", 86, "mm[Hg]"],
      [`${panelB}#8480-6`, "8480-6", 134, "mm[Hg]"],
      [store.observations[4]?.fhirId, "4548-4", 5.9, "%"],
    ]);
    expect(store.observations[1]?.effectiveAt).toEqual(
      new Date("2022-03-01T09:00:00+01:00"),
    );
    expect(store.nonNumeric.map((row) => [row.loinc, row.valueType])).toEqual([
      ["85354-9", "components"],
      ["85354-9", "components"],
    ]);
  });

  test("isSyntheaBundle needs the Synthea identifier on the Patient", async () => {
    const { isSyntheaBundle } = await import("./synthea-marker");
    const bundle = loadFixture("bp-panel.json") as {
      entry: Array<{ resource: { identifier?: unknown } }>;
    };
    expect(isSyntheaBundle(bundle)).toBe(true);

    const stripped = structuredClone(bundle);
    const patient = stripped.entry[0];
    if (!patient) throw new Error("expected a Patient entry");
    patient.resource.identifier = [{ system: "urn:example:mrn", value: "1" }];
    expect(isSyntheaBundle(stripped)).toBe(false);
    expect(isSyntheaBundle({ resourceType: "Bundle", entry: [] })).toBe(false);
  });

  test("a subject already in another cohort is rejected and nothing is written", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    store.subjects.set("b1000000-0000-4000-8000-000000000001", {
      subjectRef: "b1000000-0000-4000-8000-000000000001",
      isSynthetic: true,
      cohortId: "synthea-v4-seed42",
    });

    const report = await ingestBundle(loadFixture("bp-panel.json"), {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });
    expect(report).toEqual({
      inserted: 0,
      skipped: 0,
      unresolved: [],
      nonNumeric: 0,
      alreadyIngested: false,
      rejected: { reason: "subject-cohort-conflict" },
    });
    expect(store.bundles.size).toBe(0);
    expect(store.observations).toEqual([]);
    expect(store.subjects.get("b1000000-0000-4000-8000-000000000001")?.cohortId).toBe(
      "synthea-v4-seed42",
    );
  });

  test("ingestBundle rejects a bundle without the Synthea identifier as not-synthea", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    const bundle = structuredClone(loadFixture("bp-panel.json")) as {
      entry: Array<{ resource: { identifier?: unknown } }>;
    };
    const patient = bundle.entry[0];
    if (!patient) throw new Error("expected a Patient entry");
    patient.resource.identifier = [{ system: "urn:example:mrn", value: "1" }];

    const report = await ingestBundle(bundle, {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });
    expect(report).toEqual({
      inserted: 0,
      skipped: 0,
      unresolved: [],
      nonNumeric: 0,
      alreadyIngested: false,
      rejected: { reason: "not-synthea" },
    });
    expect(store.bundles.size).toBe(0);
    expect(store.subjects.size).toBe(0);
  });

  test("a LOINC repeated within one panel gets a stable /n suffix", async () => {
    const { mapObservations } = await import("./map-observation");
    const quantity = (value: number) => ({
      value,
      unit: "mm[Hg]",
      system: "http://unitsofmeasure.org",
      code: "mm[Hg]",
    });
    const systolic = { coding: [{ system: "http://loinc.org", code: "8480-6" }] };
    const panel = {
      resourceType: "Observation",
      id: "panel-1",
      code: { coding: [{ system: "http://loinc.org", code: "85354-9" }] },
      effectiveDateTime: "2024-01-01T08:00:00Z",
      component: [
        { code: systolic, valueQuantity: quantity(120) },
        { code: systolic, valueQuantity: quantity(124) },
        { code: systolic, valueQuantity: quantity(126) },
      ],
    };
    const ids = (rows: ReturnType<typeof mapObservations>) =>
      rows.map((row) =>
        row.kind === "missingUnit" ? row.fhirId : [row.row.fhirId, row.kind],
      );
    expect(ids(mapObservations(panel))).toEqual([
      ["panel-1#8480-6", "numeric"],
      ["panel-1#8480-6/2", "numeric"],
      ["panel-1#8480-6/3", "numeric"],
      ["panel-1", "nonNumeric"],
    ]);
    expect(ids(mapObservations(panel))).toEqual(ids(mapObservations(panel)));
  });
});

describe("subject sex, birth year and death year (#4)", () => {
  const BP_SUBJECT = "b1000000-0000-4000-8000-000000000001";
  const STORED = {
    subjectRef: BP_SUBJECT,
    isSynthetic: true,
    cohortId: COHORT,
    sex: "female",
    birthYear: 1968,
  };

  test("ingest stores the Patient's sex and birth year on the synthetic subject", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    await ingestBundle(loadFixture("bp-panel.json"), {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });
    expect(store.subjects.get(BP_SUBJECT)).toEqual(STORED);
  });

  test("re-running over an ingested bundle backfills the facts and writes no rows", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    const bundle = loadFixture("bp-panel.json");
    await ingestBundle(bundle, { cohortId: COHORT, syntheaVersion: VERSION });
    // As a row ingested before the columns existed.
    store.subjects.set(BP_SUBJECT, {
      subjectRef: BP_SUBJECT,
      isSynthetic: true,
      cohortId: COHORT,
    });

    const report = await ingestBundle(bundle, {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });
    expect(report.alreadyIngested).toBe(true);
    expect(store.observations).toHaveLength(5);
    expect(store.subjects.get(BP_SUBJECT)).toEqual(STORED);
  });

  test("a later bundle without the facts leaves them as they are", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    await ingestBundle(loadFixture("bp-panel.json"), {
      cohortId: COHORT,
      syntheaVersion: VERSION,
    });
    const bare = structuredClone(loadFixture("bp-panel.json")) as {
      entry: Array<{ resource: Record<string, unknown> }>;
    };
    const patient = bare.entry[0];
    if (!patient) throw new Error("expected a Patient entry");
    delete patient.resource.gender;
    delete patient.resource.birthDate;
    // Another bundle (another sha) for the same subject, as a wearable bundle is.
    bare.entry = bare.entry.slice(0, 1);

    await ingestBundle(bare, { cohortId: COHORT, syntheaVersion: VERSION });
    expect(store.bundles.size).toBe(2);
    expect(store.subjects.get(BP_SUBJECT)).toEqual(STORED);
  });

  test("a bundle without the Synthea identifier stores no facts", async () => {
    const { ingestBundle } = await import("./ingest-bundle");
    const bundle = structuredClone(loadFixture("bp-panel.json")) as {
      entry: Array<{ resource: { identifier?: unknown } }>;
    };
    const patient = bundle.entry[0];
    if (!patient) throw new Error("expected a Patient entry");
    patient.resource.identifier = [{ system: "urn:example:mrn", value: "1" }];
    await ingestBundle(bundle, { cohortId: COHORT, syntheaVersion: VERSION });
    expect(store.subjects.size).toBe(0);
  });
});
