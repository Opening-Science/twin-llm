import { z } from "zod";

import { type CsvCell, toCsv } from "@/infrastructure/csv";
import { EMPTY_VALUE, formatNumber } from "@/infrastructure/format-measure";

import { type EvidenceTable } from "./lab-check";

/**
 * A benchmark's result file for the Lab's Results section, such as the
 * rhythm benchmark's `latest.json` (#249). The benchmark is not written yet,
 * so the page asks for the plainest shape that holds any table: a run id, a
 * date, an optional seed and named tables of columns and rows. `docs/lab.md`
 * documents it for the benchmark to write. Pure.
 */

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const benchmarkSchema = z.object({
  run_id: z.string().min(1),
  date: z.string().optional(),
  seed: z.number().optional(),
  tables: z
    .array(
      z.object({
        title: z.string().min(1),
        note: z.string().optional(),
        columns: z.array(z.string()).min(1),
        rows: z.array(z.array(cellSchema)),
      }),
    )
    .max(50),
});

export type BenchmarkResult = z.infer<typeof benchmarkSchema>;
export type BenchmarkTable = BenchmarkResult["tables"][number];

export type BenchmarkRead =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "found"; result: BenchmarkResult }>;

/** The file's text as a result, or `unreadable` when it is not that shape. */
export const parseBenchmark = (text: string | null): BenchmarkRead => {
  if (text === null) return { kind: "missing" };
  try {
    const parsed = benchmarkSchema.safeParse(JSON.parse(text));
    return parsed.success
      ? { kind: "found", result: parsed.data }
      : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
};

const cellText = (cell: CsvCell): string => {
  if (cell === null || cell === undefined) return EMPTY_VALUE;
  if (typeof cell === "number") {
    return Number.isInteger(cell) ? formatNumber(cell, 0) : formatNumber(cell, 3);
  }
  if (typeof cell === "boolean") return cell ? "Yes" : "No";
  return cell;
};

/** A table as the page shows it: whole numbers as they are, others to 3 decimals. */
export const benchmarkTable = (table: BenchmarkTable): EvidenceTable => ({
  caption: table.title,
  columns: table.columns,
  rows: table.rows.map((row) => table.columns.map((_, index) => cellText(row[index]))),
});

/** The same table with the file's own values, for a paper. */
export const benchmarkCsv = (table: BenchmarkTable): string =>
  toCsv(
    table.columns,
    table.rows.map((row) => table.columns.map((_, index) => row[index])),
  );
