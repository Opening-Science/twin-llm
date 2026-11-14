"use client";

import type { ChatView } from "@/infrastructure/chat-view";
import type { TwinFocusId } from "@/packages/anatomy/twin-focus";

import { BodyView } from "./view-body";
import { BiomarkerView } from "./view-biomarker";
import { ComparisonView } from "./view-comparison";
import { MapView } from "./view-map";
import { TableView } from "./view-table";
import { captionAside, viewAnchorId } from "./view-text";
import { TimeseriesView } from "./view-timeseries";

export { viewAnchorId } from "./view-text";

/**
 * The views an answer drew (SPEC 5.5): one bordered figure each under the
 * answer text, in stream order, with a caption naming the view and, on the
 * right, its unit and subject. Each figure has a stable anchor so the
 * Outputs panel can scroll to it; it takes focus as a scroll target without
 * joining the tab order.
 */

type OrganPick = ((organ: TwinFocusId) => void) | undefined;

/** One view's body, by kind. */
export const ViewBody = ({
  view,
  onOrganPick,
}: Readonly<{ view: ChatView; onOrganPick?: OrganPick }>) => {
  switch (view.kind) {
    case "chart.timeseries":
      return <TimeseriesView spec={view.spec} />;
    case "chart.compare":
      return <ComparisonView title={view.title} spec={view.spec} />;
    case "biomarker.card":
      return <BiomarkerView spec={view.spec} />;
    case "table":
      return <TableView title={view.title} spec={view.spec} />;
    case "twin.body":
      return <BodyView spec={view.spec} onOrganPick={onOrganPick} />;
    case "map.choropleth":
      return <MapView title={view.title} spec={view.spec} />;
  }
};

/** A view as a captioned figure; `id` is its anchor, or none when drawn twice. */
export const ViewFigure = ({
  view,
  id,
  onOrganPick,
}: Readonly<{ view: ChatView; id?: string; onOrganPick?: OrganPick }>) => {
  const aside = captionAside(view);
  return (
    <figure
      id={id}
      tabIndex={id === undefined ? undefined : -1}
      className="compare-view-figure border-border flex min-w-0 flex-col gap-2 rounded-lg border p-3"
    >
      <figcaption className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 font-medium">{view.title}</span>
        {aside === "" ? null : (
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            {aside}
          </span>
        )}
      </figcaption>
      <ViewBody view={view} onOrganPick={onOrganPick} />
    </figure>
  );
};

export const AnswerViews = ({
  answerId,
  views,
  onOrganPick,
}: Readonly<{
  answerId: string;
  views: readonly ChatView[];
  onOrganPick?: (organ: TwinFocusId) => void;
}>) =>
  views.length === 0 ? null : (
    <div className="flex flex-col gap-3">
      {views.map((view) => (
        <ViewFigure
          key={view.id}
          view={view}
          id={viewAnchorId(answerId, view.id)}
          onOrganPick={onOrganPick}
        />
      ))}
    </div>
  );
