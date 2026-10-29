import { describe, expect, test } from "bun:test";

import type { ImportedDataPermitDecision } from "@/infrastructure/data-mode-policy";
import type { AppendInput } from "@/packages/audit/append";

import type {
  ImportedDataPorts,
  ImportedDatasetRecord,
  ImportedObservationRecord,
  ImportedSeriesGroup,
  ImportedSeriesQuery,
} from "./imported-ports";
import { importedTrendInput } from "./imported-schemas";
import {
  IMPORTED_TOOL_FAILED,
  type ImportedToolDeps,
  runImportedDatasets,
  runImportedLatest,
  runImportedTrend,
} from "./imported-tools";
import type { SessionScope } from "./scope";

/**
 * Made-up imported data, read through in-memory ports. Three datasets: labs
 * with glucose (one row dated only to a month), a ring export with HRV RMSSD
 * stored by name, and a watch export with HRV SDNN coded 80404-7.
 */
const LOINC = "http://loinc.org";
const SCOPE: SessionScope = { actor: "user-1", sessionId: "turn-1", mode: "personal" };
const ALLOWED: ImportedDataPermitDecision = { ok: true };

type Row = ImportedObservationRecord & Readonly<{ codeSystem: string | null }>;

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T08:00:00.000Z");

const row = (
  id: string,
  datasetId: string,
  code: string | null,
  display: string,
  day: number,
  value: number,
  unit: string,
  effectivePrecision: Row["effectivePrecision"] = "instant",
): Row => ({
  id,
  datasetId,
  codeSystem: code === null ? null : LOINC,
  code,
  display,
  value,
  unit,
  effectiveAt: new Date(T0 + day * DAY),
  effectivePrecision,
});

const ROWS: readonly Row[] = [
  row("g1", "ds-labs", "2345-7", "Glucose", 0, 90, "mg/dL"),
  row("g2", "ds-labs", "2345-7", "Glucose", 2, 94, "mg/dL"),
  row("g3", "ds-labs", "2345-7", "Glucose", 4, 98, "mg/dL"),
  row("g0", "ds-labs", "2345-7", "Glucose", -300, 5.1, "mmol/L", "month"),
  row("r1", "ds-ring", null, "HRV (RMSSD)", 0, 40, "ms"),
  row("r2", "ds-ring", null, "HRV (RMSSD)", 1, 42, "ms"),
  row("r3", "ds-ring", null, "HRV (RMSSD)", 2, 44, "ms"),
  row("r4", "ds-ring", null, "HRV (RMSSD)", 3, 46, "ms"),
  row("s1", "ds-watch", "80404-7", "HRV SDNN", 0, 55, "ms"),
  row("s2", "ds-watch", "80404-7", "HRV SDNN", 1, 50, "ms"),
  row("s3", "ds-watch", "80404-7", "HRV SDNN", 2, 45, "ms"),
];

const DATASETS: readonly ImportedDatasetRecord[] = [
  {
    id: "ds-watch",
    kind: "apple-health",
    name: "Made-up watch",
    rowCount: 3,
    firstAt: "2026-01-01",
    lastAt: "2026-01-03",
  },
  {
    id: "ds-ring",
    kind: "wearable",
    name: "Made-up ring",
    rowCount: 4,
    firstAt: "2026-01-01",
    lastAt: "2026-01-04",
  },
  {
    id: "ds-labs",
    kind: "lab-csv",
    name: "Made-up labs",
    rowCount: 4,
    firstAt: "2025-03",
    lastAt: "2026-01-05",
  },
];

const strip = ({ codeSystem: _codeSystem, ...rest }: Row): ImportedObservationRecord =>
  rest;

const byTime = (a: Row, b: Row) =>
  a.effectiveAt.getTime() - b.effectiveAt.getTime() || a.id.localeCompare(b.id);

const inSeries = (query: ImportedSeriesQuery) => (candidate: Row) =>
  candidate.datasetId === query.datasetId &&
  (query.code !== null
    ? candidate.codeSystem === LOINC && candidate.code === query.code
    : candidate.code === null && candidate.display === query.name) &&
  candidate.effectiveAt >= query.start &&
  candidate.effectiveAt <= query.end;

const groupsOf = (rows: readonly Row[]): ImportedSeriesGroup[] => {
  const groups = new Map<string, ImportedSeriesGroup>();
  for (const each of rows) {
    const key = [
      each.datasetId,
      each.codeSystem,
      each.code,
      each.display,
      each.unit,
    ].join("|");
    const seen = groups.get(key);
    groups.set(key, {
      datasetId: each.datasetId,
      codeSystem: each.codeSystem,
      code: each.code,
      display: each.display,
      unit: each.unit,
      n: (seen?.n ?? 0) + 1,
      firstAt:
        seen !== undefined && seen.firstAt < each.effectiveAt
          ? seen.firstAt
          : each.effectiveAt,
      lastAt:
        seen !== undefined && seen.lastAt > each.effectiveAt
          ? seen.lastAt
          : each.effectiveAt,
    });
  }
  return [...groups.values()];
};

const fakePorts = (
  rows: readonly Row[],
  audit: AppendInput[],
  overrides: Partial<ImportedDataPorts> = {},
): ImportedDataPorts => ({
  listDatasets: async () => DATASETS,
  listSeries: async (take) => groupsOf(rows).slice(0, take),
  findLatest: async (query) =>
    query.codes.flatMap((code) => {
      const newest = rows
        .filter(
          (each) =>
            each.codeSystem === LOINC &&
            each.code === code &&
            (query.datasetId === null || each.datasetId === query.datasetId),
        )
        .sort((a, b) => byTime(b, a))[0];
      return newest === undefined ? [] : [strip(newest)];
    }),
  findSeries: async (query) =>
    rows.filter(inSeries(query)).sort(byTime).slice(0, query.take).map(strip),
  appendAudit: async (input) => {
    audit.push(input);
  },
  ...overrides,
});

const harness = (
  options: Readonly<{
    rows?: readonly Row[];
    permit?: ImportedDataPermitDecision;
    ports?: Partial<ImportedDataPorts>;
  }> = {},
) => {
  const audit: AppendInput[] = [];
  const deps: ImportedToolDeps = {
    scope: SCOPE,
    permit: () => options.permit ?? ALLOWED,
    ports: fakePorts(options.rows ?? ROWS, audit, options.ports),
  };
  return { deps, audit };
};

const auditRow = (
  tool: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  rowCount: number,
): AppendInput => ({
  actor: "user-1",
  sessionId: "turn-1",
  subjectRef: null,
  tool,
  args,
  result,
  rowCount,
});

const JANUARY = { start: "2026-01-01", end: "2026-01-31" };

describe("the imported-data permit", () => {
  test("a model not on this machine is refused before any read, and audited", async () => {
    const reads: string[] = [];
    const { deps, audit } = harness({
      permit: {
        ok: false,
        code: "IMPORTED_DATA_NOT_PERMITTED",
        reason: "chat-model-not-local",
      },
      ports: {
        listDatasets: async () => {
          reads.push("listDatasets");
          return DATASETS;
        },
        findLatest: async () => {
          reads.push("findLatest");
          return [];
        },
      },
    });
    expect(await runImportedLatest(deps, { loinc: ["2345-7"] })).toEqual({
      code: "IMPORTED_DATA_NOT_PERMITTED",
      error:
        "imported data is read only by a model on this machine (Ollama on loopback), so nothing was read",
      reason: "chat-model-not-local",
    });
    expect(reads).toEqual([]);
    expect(audit).toEqual([
      auditRow(
        "imported_latest",
        { codes: 1, dataset_id: null },
        { code: "IMPORTED_DATA_NOT_PERMITTED" },
        0,
      ),
    ]);
  });

  test("synthetic mode is refused as not personal", async () => {
    const { deps } = harness({
      permit: {
        ok: false,
        code: "IMPORTED_DATA_NOT_PERMITTED",
        reason: "data-mode-not-personal",
      },
    });
    expect(await runImportedDatasets(deps, {})).toEqual({
      code: "IMPORTED_DATA_NOT_PERMITTED",
      error: "imported data is read only in personal data mode",
      reason: "data-mode-not-personal",
    });
  });

  test("the permit is asked again on every call", async () => {
    const decisions: ImportedDataPermitDecision[] = [
      ALLOWED,
      { ok: false, code: "IMPORTED_DATA_NOT_PERMITTED", reason: "chat-model-not-local" },
    ];
    const { deps } = harness();
    const changing: ImportedToolDeps = {
      ...deps,
      permit: () => decisions.shift() ?? ALLOWED,
    };
    expect("datasets" in (await runImportedDatasets(changing, {}))).toBe(true);
    expect(await runImportedDatasets(changing, {})).toEqual({
      code: "IMPORTED_DATA_NOT_PERMITTED",
      error:
        "imported data is read only by a model on this machine (Ollama on loopback), so nothing was read",
      reason: "chat-model-not-local",
    });
  });
});

describe("imported_datasets", () => {
  test("lists datasets and series without values; audits counts only", async () => {
    const { deps, audit } = harness();
    expect(await runImportedDatasets(deps, {})).toEqual({
      datasets: [
        {
          dataset_id: "ds-watch",
          kind: "apple-health",
          name: "Made-up watch",
          row_count: 3,
          first_at: "2026-01-01",
          last_at: "2026-01-03",
          series: [
            {
              loinc: "80404-7",
              name: "HRV SDNN",
              unit: "ms",
              n: 3,
              first_at: "2026-01-01T08:00:00.000Z",
              last_at: "2026-01-03T08:00:00.000Z",
            },
          ],
          other_coded_rows: 0,
        },
        {
          dataset_id: "ds-ring",
          kind: "wearable",
          name: "Made-up ring",
          row_count: 4,
          first_at: "2026-01-01",
          last_at: "2026-01-04",
          series: [
            {
              loinc: null,
              name: "HRV (RMSSD)",
              unit: "ms",
              n: 4,
              first_at: "2026-01-01T08:00:00.000Z",
              last_at: "2026-01-04T08:00:00.000Z",
            },
          ],
          other_coded_rows: 0,
        },
        {
          dataset_id: "ds-labs",
          kind: "lab-csv",
          name: "Made-up labs",
          row_count: 4,
          first_at: "2025-03",
          last_at: "2026-01-05",
          series: [
            {
              loinc: "2345-7",
              name: "Glucose",
              unit: "mg/dL",
              n: 3,
              first_at: "2026-01-01T08:00:00.000Z",
              last_at: "2026-01-05T08:00:00.000Z",
            },
            {
              loinc: "2345-7",
              name: "Glucose",
              unit: "mmol/L",
              n: 1,
              first_at: "2025-03-07T08:00:00.000Z",
              last_at: "2025-03-07T08:00:00.000Z",
            },
          ],
          other_coded_rows: 0,
        },
      ],
      n_series: 4,
      more_series: false,
    });
    expect(audit).toEqual([
      auditRow("imported_datasets", {}, { datasets: 3, series: 4 }, 3),
    ]);
  });

  test("more series than the cap are flagged, not listed", async () => {
    const many = Array.from({ length: 301 }, (_, index) =>
      row(
        `m${index}`,
        "ds-ring",
        null,
        `Made-up measure ${String(index).padStart(3, "0")}`,
        0,
        1,
        "1",
      ),
    );
    const { deps } = harness({ rows: many });
    const result = await runImportedDatasets(deps, {});
    if (!("datasets" in result)) throw new Error("expected a listing");
    expect(result.n_series).toBe(300);
    expect(result.more_series).toBe(true);
  });
});

describe("imported_latest", () => {
  test("the newest row per code, with its dataset, unit as stored and precision", async () => {
    const { deps, audit } = harness();
    expect(
      await runImportedLatest(deps, { loinc: ["2345-7", "80404-7", "4548-4"] }),
    ).toEqual({
      rows: [
        {
          loinc: "2345-7",
          name: "Glucose",
          value: 98,
          unit: "mg/dL",
          effective_at: "2026-01-05T08:00:00.000Z",
          effective_precision: "instant",
          dataset_id: "ds-labs",
        },
        {
          loinc: "80404-7",
          name: "HRV SDNN",
          value: 45,
          unit: "ms",
          effective_at: "2026-01-03T08:00:00.000Z",
          effective_precision: "instant",
          dataset_id: "ds-watch",
        },
      ],
      codes_without_rows: ["4548-4"],
    });
    expect(audit).toEqual([
      auditRow(
        "imported_latest",
        { codes: 3, dataset_id: null },
        { rows: 2, without: 1 },
        2,
      ),
    ]);
  });

  test("HRV SDNN by its code never returns the RMSSD series stored by name", async () => {
    const { deps } = harness();
    const result = await runImportedLatest(deps, {
      loinc: ["80404-7"],
      dataset_id: "ds-ring",
    });
    expect(result).toEqual({
      code: "NO_ROWS",
      error:
        "none of these LOINC codes has an imported reading; check imported_datasets for the codes and names stored before saying there is no data",
      loinc: ["80404-7"],
    });
  });

  test("an unknown dataset id is refused before the read", async () => {
    const { deps, audit } = harness();
    expect(
      await runImportedLatest(deps, { loinc: ["2345-7"], dataset_id: "ds-someone-else" }),
    ).toEqual({
      code: "DATASET_NOT_FOUND",
      error: "no imported dataset of this person has this id; use imported_datasets",
      dataset_id: "ds-someone-else",
    });
    expect(audit).toEqual([
      auditRow(
        "imported_latest",
        { codes: 1, dataset_id: "ds-someone-else" },
        { code: "DATASET_NOT_FOUND" },
        0,
      ),
    ]);
  });
});

describe("imported_trend", () => {
  test("a LOINC series: slope 2 mg/dL per day from 90 to 98 over four days", async () => {
    const { deps, audit } = harness();
    expect(
      await runImportedTrend(deps, {
        dataset_id: "ds-labs",
        loinc: "2345-7",
        ...JANUARY,
      }),
    ).toEqual({
      dataset_id: "ds-labs",
      loinc: "2345-7",
      name: "Glucose",
      unit: "mg/dL",
      n: 3,
      first_at: "2026-01-01T08:00:00.000Z",
      last_at: "2026-01-05T08:00:00.000Z",
      slope_per_day: 2,
      slope_unit: "mg/dL/d",
      fitted_first: 90,
      fitted_last: 98,
    });
    expect(audit).toEqual([
      auditRow(
        "imported_trend",
        { dataset_id: "ds-labs", by: "loinc", start: "2026-01-01", end: "2026-01-31" },
        { n: 3 },
        3,
      ),
    ]);
  });

  test("a series stored by name: RMSSD 40 to 46, slope 2 ms per day", async () => {
    const { deps } = harness();
    expect(
      await runImportedTrend(deps, {
        dataset_id: "ds-ring",
        name: "HRV (RMSSD)",
        ...JANUARY,
      }),
    ).toEqual({
      dataset_id: "ds-ring",
      loinc: null,
      name: "HRV (RMSSD)",
      unit: "ms",
      n: 4,
      first_at: "2026-01-01T08:00:00.000Z",
      last_at: "2026-01-04T08:00:00.000Z",
      slope_per_day: 2,
      slope_unit: "ms/d",
      fitted_first: 40,
      fitted_last: 46,
    });
  });

  test("a LOINC code and a name together are refused, not combined", async () => {
    const { deps, audit } = harness();
    expect(
      await runImportedTrend(deps, {
        dataset_id: "ds-ring",
        loinc: "80404-7",
        name: "HRV (RMSSD)",
        ...JANUARY,
      }),
    ).toEqual({
      code: "SERIES_NOT_COMBINED",
      error:
        "a LOINC series and a series stored by name do not mean the same measure, so they are not combined; ask for one",
      loinc: "80404-7",
      name: "HRV (RMSSD)",
    });
    expect(audit.map((each) => [each.result, each.rowCount])).toEqual([
      [{ code: "SERIES_NOT_COMBINED" }, 0],
    ]);
  });

  test("a name never matches a coded series of the same name", async () => {
    const { deps } = harness();
    expect(
      await runImportedTrend(deps, {
        dataset_id: "ds-watch",
        name: "HRV SDNN",
        ...JANUARY,
      }),
    ).toEqual({
      dataset_id: "ds-watch",
      loinc: null,
      name: "HRV SDNN",
      unit: null,
      n: 0,
      first_at: null,
      last_at: null,
      slope_per_day: null,
      slope_unit: null,
      fitted_first: null,
      fitted_last: null,
    });
  });

  test("rows in two units are refused with both units", async () => {
    const { deps } = harness();
    expect(
      await runImportedTrend(deps, {
        dataset_id: "ds-labs",
        loinc: "2345-7",
        start: "2025-01-01",
        end: "2026-01-31",
      }),
    ).toEqual({
      code: "MIXED_UNITS",
      error:
        "the rows of this series use more than one unit as stored; nothing is converted",
      series: { loinc: "2345-7", name: null },
      units: ["mg/dL", "mmol/L"],
    });
  });

  test("a row dated only to a month is refused rather than placed on a day", async () => {
    const rows = [
      ...ROWS,
      row("g9", "ds-labs", "2345-7", "Glucose", 10, 99, "mg/dL", "month"),
    ];
    const { deps } = harness({ rows });
    expect(
      await runImportedTrend(deps, {
        dataset_id: "ds-labs",
        loinc: "2345-7",
        ...JANUARY,
      }),
    ).toEqual({
      code: "PARTIAL_DATES",
      error:
        "some rows are dated only to a month or a year, so no slope per day is fitted; narrow the window to rows with full dates",
      series: { loinc: "2345-7", name: null },
      n_partial: 1,
    });
  });

  test("more than 5000 rows is refused; exactly 5000 is fitted", async () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        row(`h${index}`, "ds-ring", null, "HRV (RMSSD)", index / 1000, 40, "ms"),
      );
    const over = harness({ rows: rows(5001) });
    expect(
      await runImportedTrend(over.deps, {
        dataset_id: "ds-ring",
        name: "HRV (RMSSD)",
        ...JANUARY,
      }),
    ).toEqual({
      code: "ROW_CAP_EXCEEDED",
      error: "more than 5000 observations in this window; narrow the window",
    });
    const atCap = harness({ rows: rows(5000) });
    const fitted = await runImportedTrend(atCap.deps, {
      dataset_id: "ds-ring",
      name: "HRV (RMSSD)",
      ...JANUARY,
    });
    expect("n" in fitted ? fitted.n : null).toBe(5000);
  });

  test("an unknown dataset is refused", async () => {
    const { deps } = harness();
    expect(
      await runImportedTrend(deps, {
        dataset_id: "ds-missing",
        loinc: "2345-7",
        ...JANUARY,
      }),
    ).toEqual({
      code: "DATASET_NOT_FOUND",
      error: "no imported dataset of this person has this id; use imported_datasets",
      dataset_id: "ds-missing",
    });
  });

  test("a read that throws is audited with a fixed name, then rethrown", async () => {
    const { deps, audit } = harness({
      ports: {
        findSeries: async () => {
          throw new Error("database down: made-up message");
        },
      },
    });
    await expect(
      runImportedTrend(deps, { dataset_id: "ds-labs", loinc: "2345-7", ...JANUARY }),
    ).rejects.toThrow("database down");
    expect(audit.map((each) => [each.result, each.rowCount])).toEqual([
      [IMPORTED_TOOL_FAILED, 0],
    ]);
  });

  test("the input needs loinc or name, and a start before the end", () => {
    expect(
      importedTrendInput.safeParse({ dataset_id: "ds-labs", ...JANUARY }).success,
    ).toBe(false);
    expect(
      importedTrendInput.safeParse({
        dataset_id: "ds-labs",
        loinc: "2345-7",
        start: "2026-02-01",
        end: "2026-01-01",
      }).success,
    ).toBe(false);
    expect(
      importedTrendInput.safeParse({
        dataset_id: "ds-labs",
        loinc: "2345-7",
        ...JANUARY,
        sql: "select 1",
      }).success,
    ).toBe(false);
  });
});

describe("audit rows hold no values, units, codes or names", () => {
  test("every argument and result written is an id, a count, a window or a code", async () => {
    const { deps, audit } = harness();
    await runImportedDatasets(deps, {});
    await runImportedLatest(deps, { loinc: ["2345-7"] });
    await runImportedTrend(deps, {
      dataset_id: "ds-ring",
      name: "HRV (RMSSD)",
      ...JANUARY,
    });
    const written = JSON.stringify(audit.map((each) => [each.args, each.result]));
    for (const secret of ["2345-7", "Glucose", "RMSSD", "mg/dL", "ms", "98", "Made-up"]) {
      expect(written).not.toContain(secret);
    }
  });
});
