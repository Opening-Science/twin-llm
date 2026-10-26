import "server-only";

import { type JSONValue, tool } from "ai";

import { type ChatView, timeseriesView } from "@/infrastructure/chat-view";
import { metricLabel } from "@/infrastructure/format-measure";
import type { OfferedMetric, WearableSummaries } from "@/infrastructure/offered-keys";
import { toChatVitronicSummary } from "@/packages/vitronic/summary";
import { modelInputSchema } from "@/packages/query-tools/model-schema";
import { defaultQueryToolPorts, type QueryToolPorts } from "@/packages/query-tools/ports";
import { isToolRefusal, type ToolRefusal } from "@/packages/query-tools/refusals";
import { loincSchema } from "@/packages/query-tools/schemas";
import type { SessionScope } from "@/packages/query-tools/scope";
import {
  runTimeseries,
  runWearableSeries,
  type SeriesResult,
  type WearableReading,
} from "@/packages/query-tools/tools";
import { showViewInput, VIEW_TOOL_DEFINITIONS } from "@/packages/query-tools/view-schema";
import type { z } from "zod";

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
      code: "COHORT_TOOLS_OFF" | "SUBJECT_REQUIRED" | "NOT_AUDITED";
      error: string;
    }>;

export type ShowViewOutput = ChatView | ShowViewRefusal;

const COHORT_TOOLS_OFF = {
  code: "COHORT_TOOLS_OFF",
  error: "the cohort record tools are turned off for this user",
} as const;

const SUBJECT_REQUIRED = {
  code: "SUBJECT_REQUIRED",
  error: "a LOINC measure needs subject (a subject_ref from list_subjects)",
} as const;

/** No audit row, no view: a point must always trace to one. */
const NOT_AUDITED = {
  code: "NOT_AUDITED",
  error: "the read was not recorded, so nothing is drawn",
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

/** The spec for a series, label from the rows, never from the model. */
const viewOf = (
  input: ShowViewInput,
  series: SeriesResult,
  sourceAuditIds: readonly string[],
): ChatView | typeof NOT_AUDITED =>
  sourceAuditIds.length === 0
    ? NOT_AUDITED
    : timeseriesView({
        spec: {
          measure: series.measure,
          label: series.display ?? metricLabel(series.measure),
          unit: series.unit,
          window: { start: input.window.start, end: input.window.end },
          subject: input.subject ?? null,
          points: series.points,
        },
        sourceAuditIds,
      });

export type ShowViewDeps = Readonly<{
  scope: SessionScope;
  ports?: QueryToolPorts;
  wearables: WearableSummaries;
  /** False when the user turned the cohort record tools off. */
  cohortRecords: boolean;
}>;

export const runShowView = async (
  deps: ShowViewDeps,
  input: ShowViewInput,
): Promise<ShowViewOutput> => {
  const audit = recordingAudit(deps.ports ?? defaultQueryToolPorts());
  const window = { start: input.window.start, end: input.window.end };
  if (loincSchema.safeParse(input.measure).success) {
    if (!deps.cohortRecords) return COHORT_TOOLS_OFF;
    if (input.subject === undefined) return SUBJECT_REQUIRED;
    const series = await runTimeseries(
      deps.scope,
      { subject_ref: input.subject, loinc: input.measure, ...window },
      audit.ports,
    );
    return isToolRefusal(series) ? series : viewOf(input, series, audit.seqs);
  }
  const series = await runWearableSeries(
    deps.scope,
    { key: input.measure, ...window },
    wearableReadings(deps.wearables),
    audit.ports,
  );
  return viewOf(input, series, audit.seqs);
};

/** What the model reads back: what was drawn, not the points again. */
export const modelNoteOf = (output: ShowViewOutput): JSONValue =>
  "code" in output
    ? { code: output.code, error: output.error }
    : {
        shown: true,
        view_id: output.id,
        title: output.title,
        readings: output.spec.points.length,
        unit: output.spec.unit,
        ...(output.spec.points.length === 0
          ? { note: "no readings in this window; the view says so and draws no chart" }
          : {}),
      };

export const createShowViewTool = (deps: ShowViewDeps) => ({
  show_view: tool({
    description: VIEW_TOOL_DEFINITIONS[0].description,
    inputSchema: modelInputSchema(showViewInput),
    execute: async (input): Promise<ShowViewOutput> => runShowView(deps, input),
    toModelOutput: ({ output }) => ({ type: "json", value: modelNoteOf(output) }),
  }),
});
