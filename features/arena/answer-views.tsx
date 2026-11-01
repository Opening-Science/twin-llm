"use client";

import { Choropleth } from "@/infrastructure/charts/choropleth";
import { type ChatView, type ViewOf } from "@/infrastructure/chat-view";

import { TimeLineChart } from "@/features/data-explorer/time-line-chart";

import { BiomarkerCard } from "./biomarker-card";
import { CompareChart } from "./compare-chart";
import { viewAnchorId } from "./thread-outputs";
import { TwinBodyFigure } from "./twin-body-figure";
import { viewChart } from "./view-chart";
import { ViewTable } from "./view-table";

export const NO_READINGS = "No readings in this window.";

const TimeseriesBody = ({
  view,
  height,
}: Readonly<{ view: ViewOf<"chart.timeseries">; height: number }>) => {
  const chart = viewChart(view);
  return chart === null ? (
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
  );
};

const ViewBody = ({ view, height }: Readonly<{ view: ChatView; height: number }>) => {
  switch (view.kind) {
    case "chart.timeseries":
      return <TimeseriesBody view={view} height={height} />;
    case "chart.compare":
      return <CompareChart spec={view.spec} label={view.title} height={height} />;
    case "biomarker.card":
      return <BiomarkerCard spec={view.spec} />;
    case "table":
      return <ViewTable spec={view.spec} label={view.title} />;
    case "twin.body":
      return <TwinBodyFigure spec={view.spec} />;
    case "map.choropleth":
      return (
        <Choropleth
          title={view.title}
          unit={view.spec.unit}
          measure={view.spec.measure}
          level={view.spec.level}
          country={view.spec.country}
          regions={view.spec.regions}
          unmatched={view.spec.unmatched}
        />
      );
  }
};

/**
 * One view, drawn from the rows its audited queries returned. The Outputs
 * panel draws the same figure larger. `id` makes it a scroll target; it then
 * takes focus without joining the tab order.
 */
export const ViewFigure = ({
  view,
  id,
  height = 200,
}: Readonly<{ view: ChatView; id?: string; height?: number }>) => (
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
    <ViewBody view={view} height={height} />
  </figure>
);

/** The answer's views, each drawn from the rows its audited queries returned. */
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
