import type { ChatView } from "@/infrastructure/chat-view";
import { measureKindFor } from "@/infrastructure/format-measure";

import type { ChartSeries } from "@/features/wearables/interactive-chart";

/**
 * A view's points as the wearables chart takes them: one point per UTC day,
 * the last reading of the day, exactly as the audited query returned it.
 * No points gives null, so the view says there were none instead of drawing.
 */
export const viewChartSeries = (view: ChatView): ChartSeries | null => {
  if (view.spec.points.length === 0) return null;
  const byDay = new Map(
    view.spec.points.map((point) => [point.at.slice(0, 10), point.value] as const),
  );
  return {
    id: view.id,
    label: view.spec.label,
    points: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value })),
    kind: measureKindFor(view.spec.measure, view.spec.unit ?? undefined) ?? undefined,
  };
};
