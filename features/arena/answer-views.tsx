"use client";

import type { ChatView } from "@/infrastructure/chat-view";

import { TimeLineChart } from "@/features/data-explorer/time-line-chart";

import { viewChart } from "./view-chart";

export const NO_READINGS = "No readings in this window.";

const AnswerView = ({ view }: { readonly view: ChatView }) => {
  const chart = viewChart(view);
  return (
    <figure className="border-border flex flex-col gap-2 rounded-lg border p-3">
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
          height={200}
        />
      )}
    </figure>
  );
};

/** The answer's views, each drawn from the rows its audited query returned. */
export const AnswerViews = ({ views }: { readonly views: readonly ChatView[] }) =>
  views.length === 0 ? null : (
    <div className="flex flex-col gap-3">
      {views.map((view) => (
        <AnswerView key={view.id} view={view} />
      ))}
    </div>
  );
