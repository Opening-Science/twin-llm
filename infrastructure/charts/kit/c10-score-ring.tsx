import { categoryTextClass } from "../category-token";
import { scoreRing } from "./kit-geometry";
import { join } from "./kit-parts";
import type { ScoreRingProps } from "./types";

const SIZE = 132;
const STROKE = 18;

/**
 * C10: a ring of parts, each part's arc as long as its share of the score,
 * filled to its value. The score sits in the middle; the title, the band
 * word and each part as "value/max" sit beside it.
 */
export const ScoreRing = ({
  category,
  state = "default",
  title,
  band,
  parts,
}: ScoreRingProps) => {
  const ring = scoreRing(parts, SIZE, STROKE);
  return (
    <div className="flex items-center justify-between gap-4" data-state={state}>
      <div className="min-w-0 space-y-2">
        <p className="text-foreground font-sans">{title}</p>
        {state === "default" ? (
          <>
            <p className={join("text-insight font-sans", categoryTextClass(category))}>
              {band}
            </p>
            <ul className="text-muted-foreground space-y-0.5 font-mono text-xs tabular-nums">
              {parts.map((p) => (
                <li key={p.label}>
                  {p.label}: {Math.round(p.value)}/{Math.round(p.max)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="bg-chart-track h-4 w-20 rounded-full motion-safe:animate-pulse" />
        )}
      </div>
      <svg
        aria-hidden="true"
        focusable="false"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0"
      >
        <g
          className={categoryTextClass(category)}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
        >
          {ring.arcs.map((a, i) => (
            <g key={i}>
              <path
                d={a.track}
                className={join(
                  state === "empty" ? "stroke-chart-reference" : "stroke-chart-track",
                  state === "loading" && "motion-safe:animate-pulse",
                )}
                strokeWidth={state === "empty" ? 1.5 : STROKE}
              />
              {state === "default" ? (
                <path d={a.value} className="stroke-current" />
              ) : null}
            </g>
          ))}
        </g>
        {state === "default" ? (
          <text
            x={SIZE / 2}
            y={SIZE / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground font-mono text-3xl font-bold tabular-nums"
          >
            {ring.score}
          </text>
        ) : null}
      </svg>
    </div>
  );
};
