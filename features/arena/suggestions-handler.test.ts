import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import type { ObservationRecord, QueryToolPorts } from "@/packages/query-tools/ports";
import {
  runCoverage,
  runWearableCoverage,
  type WearableReading,
} from "@/packages/query-tools/tools";

import { COHORT_SUGGESTION_LOINCS } from "./suggested-questions";
import { createSuggestionsHandler, type SuggestionDeps } from "./suggestions-handler";

const SUBJECT = { ref: "synthetic-subject-1", label: "Synthetic person 1" };

const hr = (day: number): ObservationRecord => ({
  loinc: "8867-4",
  value: 70 + day,
  unitUcum: "/min",
  effectiveAt: new Date(Date.UTC(2020, 0, 1 + day * 30, 9)),
});

const fakePorts = (rows: readonly ObservationRecord[]) => {
  const audits: AppendInput[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (ref) =>
      ref === SUBJECT.ref ? { isSynthetic: true, cohortId: "synthea-v4-seed42" } : null,
    findObservations: async (query) =>
      rows.filter((row) => query.loinc.includes(row.loinc)),
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits };
};

const reading = (at: string, value: number): WearableReading => ({
  at: `${at}T00:00:00.000Z`,
  value,
  label: "Resting heart rate",
  unit: "bpm",
});

const deps = (
  overrides: Partial<SuggestionDeps>,
  ports: QueryToolPorts,
): SuggestionDeps => ({
  resolveActorId: async () => "actor-1",
  dataMode: () => "synthetic",
  findSubject: async () => SUBJECT,
  cohortCoverage: (scope, input) => runCoverage(scope, input, ports),
  loadWearables: async () => null,
  wearableCoverage: (scope, input, readings) =>
    runWearableCoverage(scope, input, readings, ports),
  today: () => "2026-10-27",
  logError: () => undefined,
  ...overrides,
});

describe("createSuggestionsHandler", () => {
  test("synthetic: one audited coverage read of the Demo's first person", async () => {
    const { ports, audits } = fakePorts([0, 1, 2].map(hr));
    const response = await createSuggestionsHandler(deps({}, ports))();
    expect(await response.json()).toEqual({
      heading: "From Synthetic person 1, synthetic",
      questions: [
        {
          label: "How has their heart rate changed across their records?",
          prompt:
            "For synthetic subject synthetic-subject-1, using LOINC 8867-4, how has their heart rate changed across their records?",
        },
      ],
    });
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [["coverage", "synthetic-subject-1", 3]],
    );
    expect(audits[0]?.actor).toBe("actor-1");
    expect(audits[0]?.args).toEqual({
      subject_ref: "synthetic-subject-1",
      loinc: [...COHORT_SUGGESTION_LOINCS],
      start: "1900-01-01",
      end: "2026-10-27",
    });
  });

  test("synthetic with no cohort loaded: no chips and no read", async () => {
    const { ports, audits } = fakePorts([]);
    const response = await createSuggestionsHandler(
      deps({ findSubject: async () => null }, ports),
    )();
    expect(await response.json()).toEqual({ heading: "", questions: [] });
    expect(audits).toEqual([]);
  });

  test("personal: the wearable keys that exist, audited as wearable_coverage", async () => {
    const { ports, audits } = fakePorts([]);
    const readings: Readonly<Record<string, readonly WearableReading[]>> = {
      "whoop.recovery.rhr": [
        reading("2026-10-01", 52),
        reading("2026-10-02", 53),
        reading("2026-10-04", 51),
      ],
    };
    const response = await createSuggestionsHandler(
      deps(
        {
          dataMode: () => "personal",
          loadWearables: async () => ({
            keys: ["whoop.recovery.rhr", "whoop.cycle.strain"],
            readings: (key) => readings[key] ?? [],
          }),
        },
        ports,
      ),
    )();
    expect(await response.json()).toEqual({
      heading: "From your linked wearables",
      questions: [
        {
          label: "How has my resting heart rate changed across my 3 days of readings?",
          prompt: "How has my resting heart rate changed across my 3 days of readings?",
        },
      ],
    });
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [["wearable_coverage", null, 3]],
    );
    expect(audits[0]?.args).toEqual({
      keys: ["whoop.recovery.rhr"],
      start: "2026-10-01",
      end: "2026-10-04",
    });
  });

  test("personal with nothing linked: no chips, and no cohort read", async () => {
    const { ports, audits } = fakePorts([0, 1, 2].map(hr));
    const response = await createSuggestionsHandler(
      deps({ dataMode: () => "personal" }, ports),
    )();
    expect(await response.json()).toEqual({ heading: "", questions: [] });
    expect(audits).toEqual([]);
  });

  test("signed out: no chips", async () => {
    const { ports, audits } = fakePorts([0, 1, 2].map(hr));
    const response = await createSuggestionsHandler(
      deps({ resolveActorId: async () => null }, ports),
    )();
    expect(await response.json()).toEqual({ heading: "", questions: [] });
    expect(audits).toEqual([]);
  });

  test("a failed read is logged by name and shows no chips", async () => {
    const { ports } = fakePorts([]);
    const logged: string[] = [];
    const response = await createSuggestionsHandler(
      deps(
        {
          findSubject: async () => {
            throw new TypeError("connection refused at 10.0.0.1");
          },
          logError: (message, name) => {
            logged.push(`${message}: ${name}`);
          },
        },
        ports,
      ),
    )();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ heading: "", questions: [] });
    expect(logged).toEqual(["[chat] suggested questions failed: TypeError"]);
  });
});
