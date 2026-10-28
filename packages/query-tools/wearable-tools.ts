import "server-only";

import { defaultQueryToolPorts, type QueryToolPorts } from "./ports";
import {
  isToolRefusal,
  type ToolRefusal,
  noWearableRows,
  sourceNotConnected,
  sourcesUnitMismatch,
  tooFewPairedDays,
  wearableMixedUnits,
  type SourceNotConnected,
} from "./refusals";
import {
  SUBJECT_SCOPE_VIOLATION,
  type SessionScope,
  type SubjectScopeViolation,
} from "./scope";
import type {
  sleepSummaryInput,
  hrvTrendInput,
  restingHrTrendInput,
  trainingLoadInput,
  WEARABLE_SOURCE_CHOICES,
  crossSourceCompareInput,
} from "./schemas";
import { windowEndDate, windowStartDate } from "./schemas";
import { recentAndBaseline, utcDay } from "./stats";
import {
  AGREEMENT_MINIMUM,
  type SourceAgreement,
  sourceAgreement,
} from "./source-agreement";
import {
  inSpan,
  sleepSummary,
  type SleepSummaryResult,
  type Span,
  trainingLoad,
  type TrainingLoadResult,
  wearableTrend,
  type WearableTrendResult,
} from "./wearable-analytics";
import {
  linkedSources,
  NO_WEARABLE_SNAPSHOTS,
  SLEEP_SOURCES,
  snapshotReadings,
  snapshotWorkouts,
  SYNTHETIC_SLEEP_CODES,
  SYNTHETIC_WORKOUT_CODES,
  syntheticReadings,
  syntheticWorkouts,
  TREND_MEASURES,
  type TrendMeasure,
  type WearableSource,
} from "./wearable-readings";
import type { WearableSummaries } from "@/infrastructure/offered-keys";
import type { z } from "zod";
import { audited, subjectInScope, type TimeWindow, readWindow } from "./tool-core";

/** The wearable tools: sleep, HRV, resting heart rate, training load and two sources compared. */
export type SleepSummaryInput = z.infer<typeof sleepSummaryInput>;
export type HrvTrendInput = z.infer<typeof hrvTrendInput>;
export type RestingHrTrendInput = z.infer<typeof restingHrTrendInput>;
export type TrainingLoadInput = z.infer<typeof trainingLoadInput>;

export type WearableInput = Readonly<{
  subject_ref?: string;
  source: (typeof WEARABLE_SOURCE_CHOICES)[number];
  start: string;
  end: string;
}>;

export type WearablePlan =
  | Readonly<{ kind: "snapshots"; sources: readonly WearableSource[] }>
  | Readonly<{ kind: "synthetic"; subjectRef: string }>;

/**
 * Which readings a wearable tool may read, scope first. Personal mode: the
 * linked snapshots of this turn, never a subject_ref. Synthetic mode: the
 * named subject's synthetic series, in scope like any cohort read; it belongs
 * to no vendor, so only `source: all` reads it.
 */
export const planWearableRead = async (
  scope: SessionScope,
  input: WearableInput,
  wearables: WearableSummaries,
  ports: QueryToolPorts,
): Promise<WearablePlan | SubjectScopeViolation | SourceNotConnected> => {
  if (scope.mode === "personal") {
    if (input.subject_ref !== undefined) return SUBJECT_SCOPE_VIOLATION;
    const linked = linkedSources(wearables);
    if (input.source === "all") {
      return linked.length === 0
        ? sourceNotConnected("all", linked)
        : { kind: "snapshots", sources: linked };
    }
    return linked.includes(input.source)
      ? { kind: "snapshots", sources: [input.source] }
      : sourceNotConnected(input.source, linked);
  }
  if (
    input.subject_ref === undefined ||
    !(await subjectInScope(scope, input.subject_ref, ports))
  ) {
    return SUBJECT_SCOPE_VIOLATION;
  }
  return input.source === "all"
    ? { kind: "synthetic", subjectRef: input.subject_ref }
    : sourceNotConnected(input.source, ["synthetic"]);
};

export const spanOf = (input: TimeWindow): Span => ({
  from: windowStartDate(input.start),
  to: windowEndDate(input.end),
});

/**
 * The window plus the 35 days a trend or a load compares, through the end of
 * the last day, so one capped read holds everything the result uses.
 */
export const comparedRead = (input: TimeWindow): TimeWindow => {
  const endDay = utcDay(windowEndDate(input.end));
  const { baseline } = recentAndBaseline(endDay);
  return {
    start:
      windowStartDate(baseline.start).getTime() < windowStartDate(input.start).getTime()
        ? baseline.start
        : input.start,
    end: endDay,
  };
};

export const wearableRowCount = (result: object): number =>
  "n" in result && typeof result.n === "number" ? result.n : 0;

export const wearableTrendTool =
  (tool: "hrv_trend" | "resting_hr_trend", measure: TrendMeasure) =>
  (
    scope: SessionScope,
    input: HrvTrendInput | RestingHrTrendInput,
    ports: QueryToolPorts = defaultQueryToolPorts(),
    wearables: WearableSummaries = NO_WEARABLE_SNAPSHOTS,
  ): Promise<WearableTrendResult | ToolRefusal> =>
    audited<WearableTrendResult | ToolRefusal>(
      scope,
      tool,
      input,
      input.subject_ref ?? null,
      async () => {
        const plan = await planWearableRead(scope, input, wearables, ports);
        if (isToolRefusal(plan)) return plan;
        const span = spanOf(input);
        const endDay = utcDay(span.to);
        const config = TREND_MEASURES[measure];
        if (plan.kind === "snapshots") {
          const series = plan.sources.map((source) => ({
            source,
            key: config.snapshot[source] ?? "",
            readings: snapshotReadings(wearables, source, config.snapshot[source]),
          }));
          return wearableTrend(measure, input.source, input, span, endDay, series);
        }
        const rows = await readWindow(
          ports,
          plan.subjectRef,
          [config.synthetic],
          comparedRead(input),
        );
        if (isToolRefusal(rows)) return rows;
        return wearableTrend(measure, input.source, input, span, endDay, [
          {
            source: "synthetic",
            key: config.synthetic,
            readings: syntheticReadings(rows, config.synthetic),
          },
        ]);
      },
      wearableRowCount,
      ports,
    );

/** `hrv_trend`: daily HRV per source, the maths in `wearableTrend` (wearable-analytics.ts). */
export const runHrvTrend = wearableTrendTool("hrv_trend", "hrv");

/** `resting_hr_trend`: daily resting heart rate per source, as `hrv_trend`. */
export const runRestingHrTrend = wearableTrendTool("resting_hr_trend", "resting_hr");

/** `sleep_summary`: main sleep per night per source (`sleepSummary`, wearable-analytics.ts). */
export const runSleepSummary = (
  scope: SessionScope,
  input: SleepSummaryInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
  wearables: WearableSummaries = NO_WEARABLE_SNAPSHOTS,
): Promise<SleepSummaryResult | ToolRefusal> =>
  audited<SleepSummaryResult | ToolRefusal>(
    scope,
    "sleep_summary",
    input,
    input.subject_ref ?? null,
    async () => {
      const plan = await planWearableRead(scope, input, wearables, ports);
      if (isToolRefusal(plan)) return plan;
      const span = spanOf(input);
      if (plan.kind === "snapshots") {
        const series = plan.sources.map((source) => ({
          source,
          fields: Object.fromEntries(
            Object.entries(SLEEP_SOURCES[source].fields).map(([field, family]) => [
              field,
              snapshotReadings(wearables, source, family),
            ]),
          ),
        }));
        return sleepSummary(input.source, input, span, series);
      }
      const rows = await readWindow(ports, plan.subjectRef, SYNTHETIC_SLEEP_CODES, input);
      if (isToolRefusal(rows)) return rows;
      const fields = Object.fromEntries(
        Object.entries(SLEEP_SOURCES.synthetic.fields).map(([field, code]) => [
          field,
          syntheticReadings(rows, code),
        ]),
      );
      return sleepSummary(input.source, input, span, [{ source: "synthetic", fields }]);
    },
    wearableRowCount,
    ports,
  );

/** `training_load`: workouts per day or week per source (`trainingLoad`, wearable-analytics.ts). */
export const runTrainingLoad = (
  scope: SessionScope,
  input: TrainingLoadInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
  wearables: WearableSummaries = NO_WEARABLE_SNAPSHOTS,
): Promise<TrainingLoadResult | ToolRefusal> =>
  audited<TrainingLoadResult | ToolRefusal>(
    scope,
    "training_load",
    input,
    input.subject_ref ?? null,
    async () => {
      const plan = await planWearableRead(scope, input, wearables, ports);
      if (isToolRefusal(plan)) return plan;
      const span = spanOf(input);
      const endDay = utcDay(span.to);
      if (plan.kind === "snapshots") {
        const sources = plan.sources.map((source) => ({
          source,
          parts: snapshotWorkouts(wearables, source),
        }));
        return trainingLoad(input.source, input, span, endDay, sources);
      }
      const rows = await readWindow(
        ports,
        plan.subjectRef,
        SYNTHETIC_WORKOUT_CODES,
        comparedRead(input),
      );
      if (isToolRefusal(rows)) return rows;
      return trainingLoad(input.source, input, span, endDay, [
        { source: "synthetic", parts: syntheticWorkouts(rows) },
      ]);
    },
    wearableRowCount,
    ports,
  );

export type CrossSourceCompareInput = z.infer<typeof crossSourceCompareInput>;

export type CrossSourceCompareResult = SourceAgreement &
  Readonly<{
    measure: string;
    source_a: WearableSource;
    source_b: WearableSource;
    key_a: string;
    key_b: string;
    unit: string | null;
    start: string;
    end: string;
  }>;

/** The snapshot key family each source records a comparable measure under, if any. */
export const compareKey = (
  measure: CrossSourceCompareInput["measure"],
  source: WearableSource,
): string | undefined => {
  switch (measure) {
    case "hrv":
      return TREND_MEASURES.hrv.snapshot[source];
    case "resting_hr":
      return TREND_MEASURES.resting_hr.snapshot[source];
    case "sleep_duration":
      return SLEEP_SOURCES[source].fields.duration;
    case "sleep_efficiency":
      return SLEEP_SOURCES[source].fields.efficiency;
  }
};

/**
 * `cross_source_compare`: two linked wearables on one daily measure, paired by
 * day, the maths in `sourceAgreement` (source-agreement.ts). Personal mode
 * only: a synthetic subject has one series and nothing to compare it with.
 */
export const runCrossSourceCompare = (
  scope: SessionScope,
  input: CrossSourceCompareInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
  wearables: WearableSummaries = NO_WEARABLE_SNAPSHOTS,
): Promise<CrossSourceCompareResult | ToolRefusal> =>
  audited<CrossSourceCompareResult | ToolRefusal>(
    scope,
    "cross_source_compare",
    input,
    null,
    async () => {
      if (scope.mode !== "personal") {
        return sourceNotConnected(input.source_a, ["synthetic"]);
      }
      const linked = linkedSources(wearables);
      for (const source of [input.source_a, input.source_b]) {
        if (!linked.includes(source)) return sourceNotConnected(source, linked);
      }
      const span = spanOf(input);
      const sides = [input.source_a, input.source_b].map((source) => {
        const key = compareKey(input.measure, source);
        return {
          source,
          key: key ?? "",
          readings: snapshotReadings(wearables, source, key).filter((reading) =>
            inSpan(reading.at, span),
          ),
        };
      });
      for (const side of sides) {
        if (side.readings.length === 0) return noWearableRows(input.measure, side.source);
        const units = [...new Set(side.readings.map((reading) => reading.unit))];
        if (units.length > 1) {
          return wearableMixedUnits(
            input.measure,
            side.source,
            units.map((unit) => unit ?? "none"),
          );
        }
      }
      const [a, b] = sides as [(typeof sides)[number], (typeof sides)[number]];
      const unitA = a.readings[0]?.unit ?? null;
      const unitB = b.readings[0]?.unit ?? null;
      if (unitA !== unitB) {
        return sourcesUnitMismatch(input.measure, [
          { source: a.source, unit: unitA },
          { source: b.source, unit: unitB },
        ]);
      }
      const agreement = sourceAgreement(a.readings, b.readings);
      if (agreement.n_pairs < AGREEMENT_MINIMUM) {
        return tooFewPairedDays(input.measure, AGREEMENT_MINIMUM, agreement.n_pairs);
      }
      return {
        measure: input.measure,
        source_a: a.source,
        source_b: b.source,
        key_a: a.key,
        key_b: b.key,
        unit: unitA,
        start: input.start,
        end: input.end,
        ...agreement,
      };
    },
    (result) => ("n_pairs" in result ? result.n_pairs : 0),
    ports,
  );
