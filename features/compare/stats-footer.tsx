import { EMPTY_VALUE } from "@/infrastructure/format-measure";
import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";

/**
 * The four measured figures under a finished answer (SPEC 5.7). A figure the
 * server could not measure is a dash in the pending style, never a zero;
 * cost is always shown, because $0.0000 is a real measurement.
 */

type Figure = Readonly<{ label: string; value: string | null }>;

const figures = (metrics: ModelResponseMetrics): readonly Figure[] => [
  {
    label: "first token",
    value:
      metrics.timeToFirstTokenMs === null
        ? null
        : `${String(Math.round(metrics.timeToFirstTokenMs))} ms`,
  },
  {
    label: "speed",
    value:
      metrics.tokensPerSecond === null
        ? null
        : `${metrics.tokensPerSecond.toFixed(1)} tok/s`,
  },
  {
    label: "tokens",
    value: metrics.totalTokens === null ? null : metrics.totalTokens.toFixed(0),
  },
  { label: "cost", value: `$${metrics.costUsd.toFixed(4)}` },
];

export const StatsFooter = ({ metrics }: Readonly<{ metrics: ModelResponseMetrics }>) => (
  <dl className="border-border flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
    {figures(metrics).map((figure) => (
      <div key={figure.label} className="metric flex items-baseline gap-1.5">
        <dt>{figure.label}</dt>
        <dd className={figure.value === null ? "metric-pending" : "metric-value"}>
          {figure.value ?? EMPTY_VALUE}
        </dd>
      </div>
    ))}
  </dl>
);
