import { EMPTY_VALUE, formatNumber } from "@/infrastructure/format-measure";
import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";

/**
 * The four measured figures under a finished answer (SPEC 5.7). A figure the
 * server could not measure is a dash in the pending style, never a zero;
 * cost is always shown, because $0.0000 is a real measurement.
 */

type Figure = Readonly<{ label: string; value: string | null }>;

/** The figures in the display locale: "7,503 ms", "45.2 tok/s", "19,589", "$0.0000". */
export const statFigures = (metrics: ModelResponseMetrics): readonly Figure[] => [
  {
    label: "first token",
    value:
      metrics.timeToFirstTokenMs === null
        ? null
        : `${formatNumber(metrics.timeToFirstTokenMs, 0)} ms`,
  },
  {
    label: "speed",
    value:
      metrics.tokensPerSecond === null
        ? null
        : `${formatNumber(metrics.tokensPerSecond, 1)} tok/s`,
  },
  {
    label: "tokens",
    value: metrics.totalTokens === null ? null : formatNumber(metrics.totalTokens, 0),
  },
  { label: "cost", value: `$${formatNumber(metrics.costUsd, 4)}` },
];

export const StatsFooter = ({ metrics }: Readonly<{ metrics: ModelResponseMetrics }>) => (
  <dl className="border-border flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
    {statFigures(metrics).map((figure) => (
      <div key={figure.label} className="metric flex items-baseline gap-1.5">
        <dt>{figure.label}</dt>
        <dd className={figure.value === null ? "metric-pending" : "metric-value"}>
          {figure.value ?? EMPTY_VALUE}
        </dd>
      </div>
    ))}
  </dl>
);
