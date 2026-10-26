"use client";

import type { ChatView } from "@/infrastructure/chat-view";

import { InteractiveChart } from "@/features/wearables/interactive-chart";
import { viewChartSeries } from "./view-series";

export const NO_READINGS = "No readings in this window.";

const AnswerView = ({ view }: { readonly view: ChatView }) => {
  const series = viewChartSeries(view);
  return (
    <figure className="border-border flex flex-col gap-2 rounded-lg border p-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{view.title}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {view.spec.unit ?? ""}
          {view.spec.subject ? ` · ${view.spec.subject}` : ""}
        </span>
      </figcaption>
      {series === null ? (
        <p className="text-muted-foreground text-sm">{NO_READINGS}</p>
      ) : (
        <InteractiveChart series={[series]} height={160} />
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
