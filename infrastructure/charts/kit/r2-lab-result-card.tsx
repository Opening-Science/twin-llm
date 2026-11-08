import { cn } from "@/infrastructure/ui";

import { categoryTextClass } from "../category-token";
import type { LabResultCardProps } from "./types";

/** Status colours follow the word; the word is what carries the outcome. */
const TONE: Readonly<Record<LabResultCardProps["outcome"]["tone"], string>> = {
  pass: "text-winner",
  fail: "text-destructive",
  neutral: "text-muted-foreground",
};

/**
 * R2, one Lab result: what was checked, its outcome as a word, one
 * sentence, and its numbers as label and value rows.
 */
export const LabResultCard = ({
  category,
  state = "default",
  title,
  outcome,
  sentence,
  rows,
}: LabResultCardProps) => (
  <article
    className="surface rounded-card flex flex-col gap-3 p-5"
    aria-busy={state === "loading" ? true : undefined}
    data-state={state}
  >
    <header className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-2.5 rounded-full bg-current",
            categoryTextClass(category),
          )}
        />
        <h3 className="text-foreground font-sans">{title}</h3>
      </span>
      {state === "default" ? (
        <span className={cn("font-mono text-xs font-bold uppercase", TONE[outcome.tone])}>
          {outcome.word}
        </span>
      ) : null}
    </header>
    {state === "loading" ? (
      <div className="space-y-2" role="status" aria-label="Loading">
        <div className="bg-chart-track h-5 w-full rounded-full motion-safe:animate-pulse" />
        <div className="bg-chart-track h-5 w-1/2 rounded-full motion-safe:animate-pulse" />
      </div>
    ) : (
      <p className="text-insight text-foreground font-sans">{sentence}</p>
    )}
    <hr className="border-border" />
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-foreground text-right font-mono tabular-nums">
            {state === "default" ? row.value : "–"}
          </dd>
        </div>
      ))}
    </dl>
  </article>
);
