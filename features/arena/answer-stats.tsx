import {
  EMPTY_VALUE,
  formatMeasure,
  formatNumber,
} from "@/infrastructure/format-measure";
import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";
import { cn } from "@/infrastructure/ui";

/**
 * The measured numbers under a finished answer. Every figure is what the
 * server timed for this call; a figure it could not measure reads as a dash,
 * never as zero. Cost is shown even though it is always $0.0000, because it is
 * a real measurement (docs/coding-standards.md).
 */
const figures = (metrics: ModelResponseMetrics) =>
  [
    ["first token", formatMeasure("ms", metrics.timeToFirstTokenMs)],
    ["speed", formatMeasure("tokensPerSecond", metrics.tokensPerSecond)],
    ["tokens", formatNumber(metrics.totalTokens, 0)],
    ["cost", formatMeasure("costUsd", metrics.costUsd)],
  ] as const;

export const AnswerStats = ({ metrics }: { readonly metrics: ModelResponseMetrics }) => (
  <dl className="flex flex-wrap gap-x-5 gap-y-1">
    {figures(metrics).map(([label, value]) => (
      <div key={label} className="metric flex items-baseline gap-1.5">
        <dt>{label}</dt>
        <dd className={cn(value === EMPTY_VALUE ? "metric-pending" : "metric-value")}>
          {value}
        </dd>
      </div>
    ))}
  </dl>
);
