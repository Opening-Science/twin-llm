import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import { parseFhir } from "@/packages/personal-data/parse-fhir";
import { parseResearchTable } from "@/packages/personal-data/parse-research-table";
import { type SavePlan, savePlan } from "@/packages/personal-data/save-plan";
import { storedColumns, storedRows } from "@/packages/personal-data/stored-table";
import type { ParsedImport, TableColumn } from "@/packages/personal-data/types";

import type { ImportedDataPorts } from "./imported-ports";
import {
  conditionEntry,
  cutCell,
  missingColumns,
  selectColumns,
  tableColumnsById,
} from "./imported-records";
import { runImportedConditions, runImportedTable } from "./imported-tools";

/**
 * The pure helpers behind imported_table and imported_conditions, and both
 * tools over the made-up import fixtures (tests/fixtures/personal-import):
 * parsed, planned and read back as the store would, JSON and all.
 */

const COLUMNS: readonly TableColumn[] = [
  { name: "id", type: "text", missing: 0 },
  { name: "age", type: "number", missing: 1 },
  { name: "Age", type: "number", missing: 0 },
];

describe("missingColumns", () => {
  test("names are matched whole and by case, in the order asked", () => {
    expect(missingColumns(COLUMNS, ["age", "AGE", "id", "ag"])).toEqual(["AGE", "ag"]);
    expect(missingColumns(COLUMNS, ["Age"])).toEqual([]);
    expect(missingColumns([], ["id"])).toEqual(["id"]);
  });
});

describe("cutCell", () => {
  test("only text over the cap is cut", () => {
    expect(cutCell("abcdef", 3)).toEqual({ cell: "abc", cut: true });
    expect(cutCell("abc", 3)).toEqual({ cell: "abc", cut: false });
    expect(cutCell(123456, 3)).toEqual({ cell: 123456, cut: false });
    expect(cutCell(null, 3)).toEqual({ cell: null, cut: false });
    expect(cutCell("x".repeat(201))).toEqual({ cell: "x".repeat(200), cut: true });
  });
});

describe("selectColumns", () => {
  test("cells in the asked order; a short row reads its absent cells as null", () => {
    expect(
      selectColumns(
        COLUMNS,
        [
          ["a", 30, 31],
          ["b", null],
        ],
        ["Age", "id"],
      ),
    ).toEqual({
      columns: [
        { name: "Age", type: "number" },
        { name: "id", type: "text" },
      ],
      rows: [
        [31, "a"],
        [null, "b"],
      ],
      cellsCut: 0,
    });
  });
});

describe("tableColumnsById", () => {
  test("names and types per table, without missing counts", () => {
    expect(
      tableColumnsById([{ datasetId: "t1", columns: COLUMNS.slice(0, 1), rowCount: 2 }]),
    ).toEqual(new Map([["t1", [{ name: "id", type: "text" }]]]));
  });
});

describe("conditionEntry", () => {
  test("dates as ISO text or null; only coded fields", () => {
    expect(
      conditionEntry({
        id: "c1",
        codeSystem: null,
        code: null,
        display: "Made-up finding",
        onsetAt: null,
        abatementAt: new Date("2024-02-01T00:00:00.000Z"),
        status: null,
      }),
    ).toEqual({
      code_system: null,
      code: null,
      display: "Made-up finding",
      onset: null,
      abatement: "2024-02-01T00:00:00.000Z",
      status: null,
    });
  });
});

const fixture = (name: string): string =>
  readFileSync(
    join(import.meta.dir, "../../tests/fixtures/personal-import", name),
    "utf8",
  );

const plan = (parsed: ParsedImport, fileName: string): SavePlan => {
  if (!parsed.ok) throw new Error("fixture did not parse");
  return savePlan(parsed, {
    userId: "user-1",
    name: "",
    fileName,
    sha256: "0".repeat(64),
    byteSize: 1,
  });
};

/** JSON in and out, as Postgres stores `columns` and `rows`. */
const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Ports over two planned imports: the table and the FHIR file. */
const fixturePorts = (audit: AppendInput[]): ImportedDataPorts => {
  const table = plan(parseResearchTable(fixture("research-table.tsv")), "study.tsv");
  const fhir = plan(parseFhir(fixture("fhir-bundle.json")), "record.json");
  const dataset = (id: string, saved: SavePlan) => ({
    id,
    kind: saved.dataset.kind,
    name: saved.dataset.name,
    rowCount: saved.dataset.rowCount,
    firstAt: saved.dataset.firstAt,
    lastAt: saved.dataset.lastAt,
  });
  return {
    listDatasets: async () => [dataset("ds-table", table), dataset("ds-fhir", fhir)],
    listSeries: async () => [],
    findLatest: async () => [],
    findSeries: async () => [],
    listTables: async () =>
      table.table === null
        ? []
        : [
            {
              datasetId: "ds-table",
              columns: storedColumns(roundTrip(table.table.columns)),
              rowCount: table.table.rowCount,
            },
          ],
    readTableRows: async (query) =>
      table.chunks.flatMap((chunk) => storedRows(roundTrip(chunk))).slice(0, query.take),
    findConditions: async () =>
      fhir.clinical
        .filter((row) => row.resourceType === "Condition")
        .map((row, index) => ({
          id: `c${index}`,
          codeSystem: row.codeSystem,
          code: row.code,
          display: row.display,
          onsetAt: row.startAt,
          abatementAt: row.endAt,
          status: row.status,
        })),
    appendAudit: async (input) => {
      audit.push(input);
    },
  };
};

const fixtureDeps = (audit: AppendInput[]) => ({
  scope: { actor: "user-1", sessionId: "turn-1", mode: "personal" as const },
  permit: () => ({ ok: true as const }),
  ports: fixturePorts(audit),
});

describe("the import fixtures through the tools", () => {
  test("the research table: chosen columns, missing cells as null", async () => {
    const audit: AppendInput[] = [];
    expect(
      await runImportedTable(fixtureDeps(audit), {
        dataset_id: "ds-table",
        columns: ["participant", "score", "visit_date"],
        limit: 50,
      }),
    ).toEqual({
      dataset_id: "ds-table",
      columns: [
        { name: "participant", type: "text" },
        { name: "score", type: "number" },
        { name: "visit_date", type: "date" },
      ],
      rows: [
        ["p01", 12.5, "2024-01-15"],
        ["p02", null, "2024-01-16"],
        ["p03", 9, "2024-02-01"],
        ["p04", 11.25, null],
      ],
      n_rows: 4,
      table_rows: 4,
      more_rows: false,
      cells_cut: 0,
    });
    expect(audit.map((each) => each.rowCount)).toEqual([4]);
  });

  test("the FHIR Condition: coded fields and dates, never its note", async () => {
    const audit: AppendInput[] = [];
    const result = await runImportedConditions(fixtureDeps(audit), {
      dataset_id: "ds-fhir",
    });
    expect(result).toEqual({
      dataset_id: "ds-fhir",
      conditions: [
        {
          code_system: "http://snomed.info/sct",
          code: "444814009",
          display: "Viral sinusitis (disorder)",
          onset: "2023-11-02T00:00:00.000Z",
          abatement: "2023-11-20T00:00:00.000Z",
          status: "resolved",
        },
      ],
      n: 1,
      more_conditions: false,
    });
    expect(fixture("fhir-bundle.json")).toContain("Made-up note text");
    expect(JSON.stringify(result)).not.toContain("note");
    expect(JSON.stringify(audit)).not.toContain("sinusitis");
  });
});
