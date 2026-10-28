import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import type { ObservationQuery, QueryToolPorts } from "@/packages/query-tools/ports";
import { showViewInput } from "@/packages/query-tools/view-schema";

import { modelNoteOf, runShowView } from "./show-view-tool";
import { latestValues, populationOf } from "./twin-body-view";

const SCOPE = { actor: "test", sessionId: "turn-twin", mode: "synthetic" } as const;
const PERSONAL = { ...SCOPE, mode: "personal" } as const;
const NO_WEARABLES = { oura: null, whoop: null, googleHealth: null, vitronic: null };
const WINDOW = { start: "2026-01-01", end: "2026-03-31" };

const fakePorts = (rows: Awaited<ReturnType<QueryToolPorts["findObservations"]>>) => {
  const audits: AppendInput[] = [];
  const queries: ObservationQuery[] = [];
  const ports: QueryToolPorts = {
    findSubject: async () => ({
      isSynthetic: true,
      cohortId: "open-twin-synthea-trimmed-3",
      sex: null,
    }),
    findObservations: async (query) => {
      queries.push(query);
      return rows;
    },
    findCohortObservations: async () => [],
    appendAudit: async (input) => {
      audits.push(input);
      return { seq: BigInt(70 + audits.length), hash: "h" };
    },
  };
  return { ports, audits, queries };
};

const reading = (loinc: string, value: number, unitUcum: string, day: string) => ({
  loinc,
  value,
  unitUcum,
  effectiveAt: new Date(`2026-${day}T08:00:00.000Z`),
});

const ROWS = [
  reading("2571-8", 120, "mg/dL", "01-10"),
  reading("2093-3", 250, "mg/dL", "01-10"),
  reading("2571-8", 180, "mg/dL", "03-02"),
];

const twin = (focus?: string, subject?: string) =>
  showViewInput.parse({
    kind: "twin.body",
    window: WINDOW,
    ...(focus ? { focus } : {}),
    ...(subject ? { subject } : {}),
  });

const deps = (ports: QueryToolPorts, scope = SCOPE) => ({
  scope,
  ports,
  wearables: NO_WEARABLES,
  cohortRecords: true,
});

describe("show_view input for twin.body", () => {
  test("focus is a closed list of systems and organs", () => {
    expect(
      showViewInput.safeParse({ kind: "twin.body", window: WINDOW, focus: "liver" }),
    ).toMatchObject({ success: true });
    expect(
      showViewInput.safeParse({ kind: "twin.body", window: WINDOW, focus: "spleen" })
        .success,
    ).toBe(false);
  });

  test("another kind without a measure is refused before any read", async () => {
    const { ports, audits } = fakePorts(ROWS);
    expect(
      await runShowView(
        deps(ports),
        showViewInput.parse({ kind: "chart.timeseries", window: WINDOW }),
      ),
    ).toMatchObject({ code: "MEASURE_REQUIRED" });
    expect(audits).toEqual([]);
  });
});

describe("show_view with twin.body", () => {
  test("a subject's newest mapped readings, placed by the organ map, from one audited read", async () => {
    const { ports, audits, queries } = fakePorts(ROWS);
    const view = await runShowView(deps(ports), twin("cardiovascular", "synthetic-1"));
    expect(view).toEqual({
      id: "view-71",
      kind: "twin.body",
      title: "Body twin: Cardiovascular system, 1 Jan 2026 – 31 Mar 2026",
      spec: {
        focus: "cardiovascular",
        label: "Cardiovascular system",
        body: "demo",
        subject: "synthetic-1",
        window: WINDOW,
        unit: null,
        organs: [
          {
            organ: "bloodvasculature",
            label: "Blood vessels",
            position: "above",
            marker: "Triglyceride",
            loinc: "2571-8",
          },
        ],
        n: 3,
      },
      sourceAuditIds: ["71"],
    });
    expect(queries.map((query) => query.loinc)).toEqual([
      ["2093-3", "2085-9", "2089-1", "2571-8", "10835-7"],
    ]);
    expect(audits).toEqual([
      {
        actor: "test",
        sessionId: "turn-twin",
        subjectRef: "synthetic-1",
        tool: "twin_body",
        args: { focus: "cardiovascular", subject_ref: "synthetic-1", ...WINDOW },
        result: {
          organs: [
            {
              organ: "bloodvasculature",
              position: "above",
              markerId: "BM-383",
              loinc: "2571-8",
              label: "Triglyceride",
            },
          ],
          n: 3,
        },
        rowCount: 3,
      },
    ]);
    expect(modelNoteOf(view)).toEqual({
      shown: true,
      view_id: "view-71",
      title: "Body twin: Cardiovascular system, 1 Jan 2026 – 31 Mar 2026",
      focus: "cardiovascular",
      body: "demo",
      readings: 3,
      organs: [{ organ: "bloodvasculature", marker: "Triglyceride", position: "above" }],
    });
  });

  test("without a subject nothing is read, but the call is still audited", async () => {
    const { ports, audits, queries } = fakePorts(ROWS);
    const view = await runShowView(deps(ports), twin("liver"));
    expect("spec" in view ? view.spec : null).toMatchObject({
      focus: "liver",
      body: "demo",
      subject: null,
      organs: [],
      n: 0,
    });
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [["twin_body", null, 0]],
    );
  });

  test("an organ with no mapped marker reads nothing", async () => {
    const { ports, queries } = fakePorts(ROWS);
    const view = await runShowView(deps(ports), twin("heart", "synthetic-1"));
    expect("spec" in view ? [view.spec.organs, view.spec.n] : null).toEqual([[], 0]);
    expect(queries).toEqual([]);
  });

  test("personal mode shows Self and refuses a cohort subject", async () => {
    const { ports } = fakePorts(ROWS);
    const self = await runShowView(deps(ports, PERSONAL), twin("lung"));
    expect("spec" in self ? self.spec.body : null).toBe("self");
    expect(
      await runShowView(deps(ports, PERSONAL), twin("liver", "synthetic-1")),
    ).toMatchObject({ code: "SUBJECT_SCOPE_VIOLATION" });
  });

  test("refuses without focus, with cohort records off, or outside the skill's kinds", async () => {
    const { ports, audits } = fakePorts(ROWS);
    expect(await runShowView(deps(ports), twin())).toMatchObject({
      code: "FOCUS_REQUIRED",
    });
    expect(
      await runShowView(
        { ...deps(ports), cohortRecords: false },
        twin("liver", "synthetic-1"),
      ),
    ).toMatchObject({ code: "COHORT_TOOLS_OFF" });
    expect(
      await runShowView({ ...deps(ports), views: ["chart.timeseries"] }, twin("liver")),
    ).toMatchObject({ code: "VIEW_NOT_ALLOWED" });
    expect(audits).toEqual([]);
  });
});

describe("latestValues", () => {
  test("the newest reading per code, rows oldest first", () => {
    expect(latestValues(ROWS)).toEqual([
      { loinc: "2571-8", value: 180, unitUcum: "mg/dL" },
      { loinc: "2093-3", value: 250, unitUcum: "mg/dL" },
    ]);
  });
});

describe("populationOf", () => {
  test("only a stored female or male sex is used", () => {
    expect(populationOf("female")).toEqual({ sex: "female" });
    expect(populationOf("male")).toEqual({ sex: "male" });
    expect(populationOf("unknown")).toEqual({});
    expect(populationOf(null)).toEqual({});
  });
});
