"use client";

import type { ChatView } from "@/infrastructure/chat-view";

import { TimeLineChart } from "@/features/data-explorer/time-line-chart";

import { viewAnchorId } from "./thread-outputs";
import { viewChart } from "./view-chart";

export const NO_READINGS = "No readings in this window.";

/**
 * One view, drawn from the rows its audited query returned. The Outputs panel
 * draws the same figure larger. `id` makes it a scroll target; it then takes
 * focus without joining the tab order.
 */
export const ViewFigure = ({
  view,
  id,
  height = 200,
}: Readonly<{ view: ChatView; id?: string; height?: number }>) => {
  const chart = viewChart(view);
  return (
    <figure
      id={id}
      tabIndex={id === undefined ? undefined : -1}
      className="view-figure border-border flex flex-col gap-2 rounded-lg border p-3"
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{view.title}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {view.spec.unit ?? ""}
          {view.spec.subject ? ` · ${view.spec.subject}` : ""}
        </span>
      </figcaption>
      {chart === null ? (
        <p className="text-muted-foreground text-sm">{NO_READINGS}</p>
      ) : (
        <TimeLineChart
          points={chart.points}
          domain={chart.domain}
          decimals={chart.decimals}
          unit={view.spec.unit ?? ""}
          label={view.title}
          timeAxis="dates"
          height={height}
        />
      )}
    </figure>
  );
};

/** The answer's views, each drawn from the rows its audited query returned. */
export const AnswerViews = ({
  views,
  answerId,
}: Readonly<{ views: readonly ChatView[]; answerId?: string }>) =>
  views.length === 0 ? null : (
    <div className="flex flex-col gap-3">
      {views.map((view) => (
        <ViewFigure
          key={view.id}
          view={view}
          id={answerId === undefined ? undefined : viewAnchorId(answerId, view.id)}
        />
      ))}
    </div>
  );
