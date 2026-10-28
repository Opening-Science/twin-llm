import "server-only";

import { type JSONValue, tool } from "ai";

import {
  biomarkerCardView,
  type ChatView,
  compareView,
  tableView,
  timeseriesView,
  viewReadings,
} from "@/infrastructure/chat-view";
import { metricLabel, metricStem } from "@/infrastructure/format-measure";
import type { OfferedMetric, WearableSummaries } from "@/infrastructure/offered-keys";
import { biomarkerByLoinc } from "@/packages/biomarkers/catalogue";
import { toChatVitronicSummary } from "@/packages/vitronic/summary";
import { modelInputSchema } from "@/packages/query-tools/model-schema";
import { defaultQueryToolPorts, type QueryToolPorts } from "@/packages/query-tools/ports";
import { isToolRefusal, type ToolRefusal } from "@/packages/query-tools/refusals";
import { loincSchema } from "@/packages/query-tools/schemas";
import type { SessionScope } from "@/packages/query-tools/scope";
import { summariseWindow } from "@/packages/query-tools/stats";
import {
  runCompareWindows,
  runRangePosition,
  runTimeseries,
  runTrend,
  runWearableSeries,
  type SeriesResult,
  type WearableReading,
} from "@/packages/query-tools/tools";
import { showViewInput, VIEW_TOOL_DEFINITIONS } from "@/packages/query-tools/view-schema";
import type { z } from "zod";

import { cardLabel, cardSpecOf, compareSpecOf, tableSpecOf } from "./view-builders";

/**
 * `show_view`: the model names a measure and a window; this runs the query
 * itself, under the turn's scope and audit, and returns the view built from
 * exactly those rows. The model never supplies a number, and only a short
 * note of what was drawn goes back to it; the browser gets the whole view
 * (`twin-ui-stream.ts` turns it into a `data-view` part).
 */

type ShowViewInput = z.infer<typeof showViewInput>;

export type ShowViewRefusal =
  | ToolRefusal
  | Readonly<{
      code:
        | "COHORT_TOOLS_OFF"
        | "SUBJECT_REQUIRED"
        | "NOT_AUDITED"
        | "VIEW_NOT_ALLOWED"
        | "UNKNOWN_MEASURE"
        | "LOINC_REQUIRED"
        | "COMPARE_WINDOW_REQUIRED";
      error: string;
    }>;

export type ShowViewOutput = ChatView | ShowViewRefusal;

const COHORT_TOOLS_OFF = {
  code: "COHORT_TOOLS_OFF",
  error: "the cohort record tools are turned off for this user",
} as const;

const SUBJECT_REQUIRED = {
  code: "SUBJECT_REQUIRED",
  error:
    "a LOINC measure needs subject: call show_view again with subject set to the subject_ref you used for the other tools",
} as const;

/** No audit row, no view: a point must always trace to one. */
const NOT_AUDITED = {
  code: "NOT_AUDITED",
  error: "the read was not recorded, so nothing is drawn",
} as const;

/** A skill turn may only draw the kinds its skill lists. */
const VIEW_NOT_ALLOWED = {
  code: "VIEW_NOT_ALLOWED",
  error: "this view kind is not allowed for the skill this turn runs",
} as const;

/**
 * Neither a LOINC code nor a wearable key: drawing it would only give an
 * empty chart that looks like "no readings", so it is refused instead.
 */
const UNKNOWN_MEASURE = {
  code: "UNKNOWN_MEASURE",
  error:
    "not a LOINC code or a wearable key; use a LOINC code with subject, or a key from the Available keys list without its date",
} as const;

/** A wearable key has no published range, so a card needs a LOINC code. */
const LOINC_REQUIRED = {
  code: "LOINC_REQUIRED",
  error:
    "biomarker.card needs a LOINC code with subject; wearable keys have no published range",
} as const;

const COMPARE_WINDOW_REQUIRED = {
  code: "COMPARE_WINDOW_REQUIRED",
  error: "chart.compare needs compare_with, the earlier window to set against window",
} as const;

const DATE_SUFFIX = /\.\d{4}-\d{2}-\d{2}$/;

/** Every dated, numeric metric of the loaded snapshots; BodyLoop through its chat filter. */
const wearableMetrics = (summaries: WearableSummaries): readonly OfferedMetric[] => [
  ...(summaries.oura?.metrics ?? []),
  ...(summaries.whoop?.metrics ?? []),
  ...(summaries.googleHealth?.metrics ?? []),
  ...(summaries.vitronic ? toChatVitronicSummary(summaries.vitronic).metrics : []),
];

/**
 * The readings of one key, matched on the whole key without its date, so
 * `sleep.hr` never picks up `sleep.hr.nap`. One reading per day, the last
 * stored one, as the wearables charts do.
 */
export const wearableReadings =
  (summaries: WearableSummaries) =>
  (key: string): readonly WearableReading[] => {
    const wanted = key.replace(DATE_SUFFIX, "").replace(/\.$/, "");
    const byDay = new Map(
      wearableMetrics(summaries).flatMap((metric) =>
        metric.key.replace(DATE_SUFFIX, "") === wanted &&
        typeof metric.value === "number" &&
        Number.isFinite(metric.value) &&
        metric.date
          ? [
              [
                metric.date,
                {
                  at: `${metric.date}T00:00:00.000Z`,
                  value: metric.value,
                  label: metricLabel(metric.key, metric.label),
                  unit: metric.unit ?? null,
                },
              ] as const,
            ]
          : [],
      ),
    );
    return [...byDay.values()];
  };

/**
 * A wearable key the app knows: one with a label of its own (`sleep.score`),
 * or one the loaded snapshots carry. `heart.rate` is neither.
 */
export const isKnownWearableKey = (
  summaries: WearableSummaries,
  key: string,
): boolean => {
  const wanted = key.replace(DATE_SUFFIX, "").replace(/\.$/, "");
  return (
    metricLabel(wanted) !== metricStem(wanted) ||
    wearableMetrics(summaries).some(
      (metric) => metric.key.replace(DATE_SUFFIX, "") === wanted,
    )
  );
};

/** The audit `seq` an append returned, when it returned one. */
const seqOf = (event: unknown): string | null =>
  typeof event === "object" &&
  event !== null &&
  "seq" in event &&
  (typeof event.seq === "bigint" || typeof event.seq === "number")
    ? String(event.seq)
    : null;

/** Ports that also note the `seq` of every audit row they append. */
const recordingAudit = (ports: QueryToolPorts) => {
  const seqs: string[] = [];
  return {
    seqs,
    ports: {
      ...ports,
      appendAudit: async (input: Parameters<QueryToolPorts["appendAudit"]>[0]) => {
        const event = await ports.appendAudit(input);
        const seq = seqOf(event);
        if (seq !== null) seqs.push(seq);
        return event;
      },
    } satisfies QueryToolPorts,
  };
};

/** A view only with an audit row behind it; the label comes from the rows, never the model. */
const audited = (
  sourceAuditIds: readonly string[],
  build: (ids: readonly string[]) => ChatView,
): ChatView | typeof NOT_AUDITED =>
  sourceAuditIds.length === 0 ? NOT_AUDITED : build(sourceAuditIds);

const labelOf = (series: SeriesResult): string =>
  series.display ?? metricLabel(series.measure);

export type ShowViewDeps = Readonly<{
  scope: SessionScope;
  ports?: QueryToolPorts;
  wearables: WearableSummaries;
  /** False when the user turned the cohort record tools off. */
  cohortRecords: boolean;
  /** View kinds this turn may draw (a skill's `views`); left out, every kind. */
  views?: readonly string[];
}>;

type Window = Readonly<{ start: string; end: string }>;

/** The measure, checked: a LOINC with its subject, or a wearable key the app knows. */
type Source =
  | Readonly<{ kind: "loinc"; loinc: string; subject: string }>
  | Readonly<{ kind: "wearable"; key: string }>;

const sourceOf = (deps: ShowViewDeps, input: ShowViewInput): Source | ShowViewRefusal => {
  if (loincSchema.safeParse(input.measure).success) {
    if (!deps.cohortRecords) return COHORT_TOOLS_OFF;
    if (input.subject === undefined) return SUBJECT_REQUIRED;
    return { kind: "loinc", loinc: input.measure, subject: input.subject };
  }
  if (input.kind === "biomarker.card") return LOINC_REQUIRED;
  if (!isKnownWearableKey(deps.wearables, input.measure)) return UNKNOWN_MEASURE;
  return { kind: "wearable", key: input.measure };
};

type Run = Readonly<{
  deps: ShowViewDeps;
  input: ShowViewInput;
  source: Source;
  ports: QueryToolPorts;
  seqs: readonly string[];
}>;

/** Every reading of the measure in one window, read and audited like `timeseries`. */
const readSeries = (run: Run, window: Window): Promise<SeriesResult | ToolRefusal> =>
  run.source.kind === "loinc"
    ? runTimeseries(
        run.deps.scope,
        { subject_ref: run.source.subject, loinc: run.source.loinc, ...window },
        run.ports,
      )
    : runWearableSeries(
        run.deps.scope,
        { key: run.source.key, ...window },
        wearableReadings(run.deps.wearables),
        run.ports,
      );

const subjectOf = (source: Source): string | null =>
  source.kind === "loinc" ? source.subject : null;

const showTimeseries = async (run: Run, window: Window): Promise<ShowViewOutput> => {
  const series = await readSeries(run, window);
  if (isToolRefusal(series)) return series;
  return audited(run.seqs, (sourceAuditIds) =>
    timeseriesView({
      spec: {
        measure: series.measure,
        label: labelOf(series),
        unit: series.unit,
        window,
        subject: subjectOf(run.source),
        points: series.points,
      },
      sourceAuditIds,
    }),
  );
};

const showTable = async (run: Run, window: Window): Promise<ShowViewOutput> => {
  const series = await readSeries(run, window);
  if (isToolRefusal(series)) return series;
  return audited(run.seqs, (sourceAuditIds) =>
    tableView({
      spec: tableSpecOf({
        output: series,
        measure: series.measure,
        label: labelOf(series),
        unit: series.unit,
        window,
        subject: subjectOf(run.source),
      }),
      sourceAuditIds,
    }),
  );
};

const valuesOf = (series: SeriesResult): readonly number[] =>
  series.points.map((point) => point.value);

/**
 * `compare_with` against `window`. For a LOINC the n and means are
 * `compare_windows`' own (window_a is `compare_with`); a wearable key gets the
 * same summary of its readings. The points come from one read per window.
 */
const showCompare = async (
  run: Run,
  before: Window,
  after: Window,
): Promise<ShowViewOutput> => {
  const compared =
    run.source.kind === "loinc"
      ? await runCompareWindows(
          run.deps.scope,
          {
            subject_ref: run.source.subject,
            loinc: run.source.loinc,
            window_a: before,
            window_b: after,
          },
          run.ports,
        )
      : null;
  if (compared !== null && isToolRefusal(compared)) return compared;
  const beforeSeries = await readSeries(run, before);
  if (isToolRefusal(beforeSeries)) return beforeSeries;
  const afterSeries = await readSeries(run, after);
  if (isToolRefusal(afterSeries)) return afterSeries;
  return audited(run.seqs, (sourceAuditIds) =>
    compareView({
      spec: compareSpecOf({
        measure: run.input.measure,
        label: afterSeries.display ?? labelOf(beforeSeries),
        unit: compared?.unit ?? afterSeries.unit ?? beforeSeries.unit,
        subject: subjectOf(run.source),
        layout: run.input.layout ?? "side-by-side",
        before: compared?.window_a ?? summariseWindow(before, valuesOf(beforeSeries)),
        after: compared?.window_b ?? summariseWindow(after, valuesOf(afterSeries)),
        beforePoints: beforeSeries.points,
        afterPoints: afterSeries.points,
      }),
      sourceAuditIds,
    }),
  );
};

/**
 * The latest reading against its Anchor v3 range, through `range_position`
 * (the Biomarkers tab's own range choice), and `trend` over the same window.
 * A code with no published range is refused as `range_position` refuses it.
 */
const showCard = async (
  run: Run,
  source: Extract<Source, { kind: "loinc" }>,
  window: Window,
): Promise<ShowViewOutput> => {
  const placed = await runRangePosition(
    run.deps.scope,
    { subject_ref: source.subject, loinc: source.loinc, ...window, pick: "latest" },
    run.ports,
  );
  if (isToolRefusal(placed)) return placed;
  const trend = await runTrend(
    run.deps.scope,
    { subject_ref: source.subject, loinc: source.loinc, ...window },
    run.ports,
  );
  if (isToolRefusal(trend)) return trend;
  return audited(run.seqs, (sourceAuditIds) =>
    biomarkerCardView({
      spec: cardSpecOf({
        label: cardLabel(
          biomarkerByLoinc(source.loinc)?.loincDisplay ?? null,
          source.loinc,
        ),
        subject: source.subject,
        window,
        placed,
        trend,
      }),
      sourceAuditIds,
    }),
  );
};

export const runShowView = async (
  deps: ShowViewDeps,
  input: ShowViewInput,
): Promise<ShowViewOutput> => {
  if (deps.views !== undefined && !deps.views.includes(input.kind)) {
    return VIEW_NOT_ALLOWED;
  }
  const source = sourceOf(deps, input);
  if ("code" in source) return source;
  if (input.kind === "chart.compare" && input.compare_with === undefined) {
    return COMPARE_WINDOW_REQUIRED;
  }
  const audit = recordingAudit(deps.ports ?? defaultQueryToolPorts());
  const run: Run = { deps, input, source, ports: audit.ports, seqs: audit.seqs };
  const window = { start: input.window.start, end: input.window.end };
  switch (input.kind) {
    case "chart.timeseries":
      return showTimeseries(run, window);
    case "table":
      return showTable(run, window);
    case "chart.compare":
      return input.compare_with === undefined
        ? COMPARE_WINDOW_REQUIRED
        : showCompare(
            run,
            { start: input.compare_with.start, end: input.compare_with.end },
            window,
          );
    case "biomarker.card":
      return source.kind === "loinc" ? showCard(run, source, window) : LOINC_REQUIRED;
  }
};

/** What the model reads back: what was drawn, not its numbers again. `open_view` shares it. */
export const modelNoteOf = (
  output: ChatView | Readonly<{ code: string; error: string }>,
): JSONValue => {
  if ("code" in output) return { code: output.code, error: output.error };
  const readings = viewReadings(output);
  return {
    shown: true,
    view_id: output.id,
    title: output.title,
    readings,
    unit: output.spec.unit,
    ...(readings === 0
      ? { note: "no readings in this window; the view says so and draws no chart" }
      : {}),
  };
};

export const createShowViewTool = (deps: ShowViewDeps) => ({
  show_view: tool({
    description: VIEW_TOOL_DEFINITIONS[0].description,
    inputSchema: modelInputSchema(showViewInput),
    execute: async (input): Promise<ShowViewOutput> => runShowView(deps, input),
    toModelOutput: ({ output }) => ({ type: "json", value: modelNoteOf(output) }),
  }),
});
