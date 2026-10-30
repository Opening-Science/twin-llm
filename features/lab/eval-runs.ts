import { z } from "zod";

import { type CsvCell, toCsv } from "@/infrastructure/csv";
import { EMPTY_VALUE, formatDate, formatNumber } from "@/infrastructure/format-measure";

import { type EvidenceTable } from "./lab-check";

/**
 * Evaluation runs for the Lab's Results section: what `bun run eval` wrote
 * to `evaluation/runs/<id>/meta.json` and what `bun run eval:report` wrote
 * to `report.md` next to it (`docs/evaluation/harness.md`). Pure: the loader
 * reads the files and hands the text here.
 *
 * Both files are read leniently. A run can be older than the current schema,
 * or have no report yet; whatever is there is shown and a missing part says
 * so. The pass rates are the report's own numbers (passes over pass + fail,
 * Wilson 95 % interval in whole percent), not recomputed.
 */

const metaSchema = z.object({
  run_id: z.string().optional(),
  date: z.string().optional(),
  mock: z.boolean().optional(),
  replay: z.boolean().optional(),
  cohort_id: z.string().optional(),
  git_sha: z.string().optional(),
  models: z
    .array(z.object({ provider: z.string(), model_id: z.string() }).loose())
    .optional(),
  selection: z
    .object({
      items: z.array(z.string()).nullable().optional(),
      scenario: z.string().nullable().optional(),
      latency_set: z.boolean().optional(),
    })
    .loose()
    .optional(),
  counts: z
    .object({
      items: z.number().optional(),
      lines: z.number().optional(),
      answered: z.number().optional(),
      errors: z.number().optional(),
    })
    .loose()
    .optional(),
});

export type RunMetaSummary = z.infer<typeof metaSchema>;

/** The parts of meta.json the page uses, or null when it is not JSON of that shape. */
export const parseRunMeta = (text: string): RunMetaSummary | null => {
  try {
    const parsed = metaSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export type ScoreCell = Readonly<{
  passes: number;
  n: number;
  lowPct: number;
  highPct: number;
}>;

/** `3/4 (30–95 %)` as the report writes it; anything else is null. */
export const parseScoreCell = (text: string): ScoreCell | null => {
  const match = /^(\d+)\/(\d+) \((\d+)[–-](\d+) %\)$/.exec(text.trim());
  if (match === null) return null;
  const [, passes, n, low, high] = match.map(Number);
  return { passes: passes!, n: n!, lowPct: low!, highPct: high! };
};

export type ModelScores = Readonly<{
  model: string;
  /** Scenario columns and "All", in the report's order. */
  columns: readonly string[];
  rows: ReadonlyArray<
    Readonly<{ criterion: string; cells: readonly (ScoreCell | null)[] }>
  >;
}>;

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isDivider = (line: string): boolean =>
  /^\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?$/.test(line.trim());

/** The first Markdown table at or after `start`: its header and body rows. */
const tableAfter = (
  lines: readonly string[],
  start: number,
): Readonly<{ header: string[]; rows: string[][] }> | null => {
  const from = lines.findIndex(
    (line, index) => index >= start && line.trim().startsWith("|"),
  );
  if (from === -1 || !isDivider(lines[from + 1] ?? "")) return null;
  const body: string[][] = [];
  for (const line of lines.slice(from + 2)) {
    if (!line.trim().startsWith("|")) break;
    body.push(cellsOf(line));
  }
  return { header: cellsOf(lines[from]!), rows: body };
};

/** Each "## Scores: <model>" table of a report.md. */
export const parseReportScores = (markdown: string): readonly ModelScores[] => {
  const lines = markdown.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    const heading = /^## Scores: (.+)$/.exec(line.trim());
    if (heading === null) return [];
    const table = tableAfter(lines, index + 1);
    if (table === null || table.header[0] !== "Criterion") return [];
    return [
      {
        model: heading[1]!,
        columns: table.header.slice(1),
        rows: table.rows.map((row) => ({
          criterion: row[0] ?? "",
          cells: row.slice(1).map(parseScoreCell),
        })),
      },
    ];
  });
};

export type EvalRun = Readonly<{
  id: string;
  meta: RunMetaSummary | null;
  /** Null when the run has no report.md yet. */
  scores: readonly ModelScores[] | null;
}>;

export const summariseRun = (
  id: string,
  metaText: string | null,
  reportText: string | null,
): EvalRun => ({
  id,
  meta: metaText === null ? null : parseRunMeta(metaText),
  scores: reportText === null ? null : parseReportScores(reportText),
});

/** Newest first by the date in meta.json, then by run id. */
export const sortRuns = (runs: readonly EvalRun[]): readonly EvalRun[] =>
  [...runs].sort(
    (a, b) =>
      (b.meta?.date ?? "").localeCompare(a.meta?.date ?? "") || b.id.localeCompare(a.id),
  );

export const selectionText = (meta: RunMetaSummary | null): string => {
  const selection = meta?.selection;
  if (selection === undefined) return EMPTY_VALUE;
  if (selection.items != null && selection.items.length > 0) {
    return `${selection.items.length} chosen items`;
  }
  if (selection.scenario != null) return `Scenario ${selection.scenario}`;
  if (selection.latency_set === true) return "Latency set";
  return "All items";
};

const modelsText = (meta: RunMetaSummary | null): string =>
  meta?.models === undefined || meta.models.length === 0
    ? EMPTY_VALUE
    : meta.models.map((model) => `${model.provider}:${model.model_id}`).join(", ");

const countText = (value: number | undefined): string =>
  value === undefined ? EMPTY_VALUE : formatNumber(value, 0);

const kindText = (meta: RunMetaSummary | null): string =>
  meta?.mock === true
    ? "Mock (a harness test)"
    : meta?.replay === true
      ? "Replay"
      : "Run";

export const runsTable = (runs: readonly EvalRun[]): EvidenceTable => ({
  caption: "Evaluation runs on this machine",
  columns: ["Run", "Date", "Kind", "Models", "Selection", "Lines", "Errors", "Report"],
  rows: runs.map((run) => [
    run.id,
    run.meta?.date === undefined ? EMPTY_VALUE : formatDate(run.meta.date),
    run.meta === null ? "No readable meta.json" : kindText(run.meta),
    modelsText(run.meta),
    selectionText(run.meta),
    countText(run.meta?.counts?.lines),
    countText(run.meta?.counts?.errors),
    run.scores === null ? "Not written" : "Yes",
  ]),
});

export const runsCsv = (runs: readonly EvalRun[]): string =>
  toCsv(
    ["run_id", "date", "kind", "models", "selection", "lines", "errors", "report"],
    runs.map((run): readonly CsvCell[] => [
      run.id,
      run.meta?.date,
      run.meta === null ? null : kindText(run.meta),
      modelsText(run.meta) === EMPTY_VALUE ? null : modelsText(run.meta),
      selectionText(run.meta) === EMPTY_VALUE ? null : selectionText(run.meta),
      run.meta?.counts?.lines,
      run.meta?.counts?.errors,
      run.scores !== null,
    ]),
  );

/** "3/4 · 30–95 %", or a dash when nothing was scored. */
export const scoreCellText = (cell: ScoreCell | null): string =>
  cell === null
    ? EMPTY_VALUE
    : `${cell.passes}/${cell.n} · ${cell.lowPct}–${cell.highPct} %`;

export const scoreTable = (scores: ModelScores): EvidenceTable => ({
  caption: `Pass rates of ${scores.model}`,
  columns: ["Criterion", ...scores.columns],
  rows: scores.rows.map((row) => [row.criterion, ...row.cells.map(scoreCellText)]),
});

/** Every score cell of every run, one row each, for a paper's table or figure. */
export const scoresCsv = (runs: readonly EvalRun[]): string =>
  toCsv(
    [
      "run_id",
      "model",
      "criterion",
      "scenario",
      "passes",
      "n",
      "pass_rate",
      "wilson95_low_pct",
      "wilson95_high_pct",
    ],
    runs.flatMap((run) =>
      (run.scores ?? []).flatMap((model) =>
        model.rows.flatMap((row) =>
          row.cells.map((cell, index): readonly CsvCell[] => [
            run.id,
            model.model,
            row.criterion,
            model.columns[index],
            cell?.passes,
            cell?.n,
            cell === null || cell.n === 0 ? null : cell.passes / cell.n,
            cell?.lowPct,
            cell?.highPct,
          ]),
        ),
      ),
    ),
  );
