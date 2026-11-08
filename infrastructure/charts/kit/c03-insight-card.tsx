import { categoryTextClass } from "../category-token";
import { join } from "./kit-parts";
import type { InsightCardProps } from "./types";

/**
 * C03, the card every chart sits in: a label row, one sentence, a hairline,
 * one body. The sentence is the chart's text for a screen reader, so the
 * body under it is hidden from assistive technology.
 */
export const InsightCard = ({
  category,
  state = "default",
  label,
  sentence,
  emptyNote,
  children,
}: InsightCardProps) => (
  <article
    className="surface rounded-card flex flex-col gap-3 p-5"
    aria-busy={state === "loading" ? true : undefined}
    data-state={state}
  >
    <header className="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={join(
          "inline-block size-2.5 rounded-full bg-current",
          categoryTextClass(category),
        )}
      />
      <h3 className="text-foreground font-sans">{label}</h3>
    </header>
    {state === "loading" ? (
      <div className="space-y-2" role="status" aria-label="Loading">
        <div className="bg-chart-track h-5 w-full rounded-full motion-safe:animate-pulse" />
        <div className="bg-chart-track h-5 w-2/3 rounded-full motion-safe:animate-pulse" />
      </div>
    ) : (
      <p className="text-insight text-foreground font-sans">{sentence}</p>
    )}
    {children ? (
      <>
        <hr className="border-border" />
        <div aria-hidden="true">{children}</div>
      </>
    ) : null}
    {state === "empty" && emptyNote ? (
      <p className="text-muted-foreground font-mono text-xs tabular-nums">{emptyNote}</p>
    ) : null}
  </article>
);
