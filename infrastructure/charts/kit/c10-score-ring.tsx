"use client";

import { cn } from "@/infrastructure/ui";

import { categoryTextClass } from "../category-token";
import { ChartFocusFrame, ChartReadout, dimmed, useChartFocus } from "./chart-focus";
import { ringPartAt, scoreRing } from "./kit-geometry";
import type { ScoreRingProps } from "./types";

const SIZE = 132;
const STROKE = 18;

/**
 * C10: a ring of parts, each part's arc as long as its share of the score,
 * filled to its value. The score sits in the middle; the title, the band
 * word and each part as "value/max" sit beside it. With readouts, a click
 * or tap round the ring pins the part in that direction (again to clear) and the arrow keys step
 * round the ring; the other parts step back and the readout names it.
 */
export const ScoreRing = ({
  category,
  state = "default",
  title,
  band,
  parts,
  label,
  defaultFocus,
}: ScoreRingProps) => {
  const ring = scoreRing(parts, SIZE, STROKE);
  const live = state === "default" && parts.some((p) => p.readout);
  const focus = useChartFocus({
    count: parts.length,
    tap: true,
    defaultFocus,
    // Anywhere round the ring, the part in that direction.
    pick: (x, y, width, height) => ringPartAt(x - width / 2, y - height / 2, parts),
  });
  const focused = live ? focus.index : null;
  const svg = (
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
          <g key={i} opacity={dimmed(focused, i)} data-focus-index={live ? i : undefined}>
            <path
              d={a.track}
              className={cn(
                state === "empty" ? "stroke-chart-reference" : "stroke-chart-track",
                state === "loading" && "motion-safe:animate-pulse",
              )}
              strokeWidth={state === "empty" ? 1.5 : STROKE}
            />
            {state === "default" ? (
              <path d={a.value} pathLength={1} className="kit-draw stroke-current" />
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
  );
  const body = (
    <div className="flex items-center justify-between gap-4" data-state={state}>
      <div className="min-w-0 space-y-2">
        <p className="text-foreground font-sans">{title}</p>
        {state === "default" ? (
          <>
            <p className={cn("text-insight font-sans", categoryTextClass(category))}>
              {band}
            </p>
            <ul className="text-muted-foreground space-y-0.5 font-mono text-xs tabular-nums">
              {parts.map((p) => (
                <li
                  key={p.label}
                  // The focused part reads in foreground; the list is muted already.
                  className={focused === parts.indexOf(p) ? "text-foreground" : undefined}
                >
                  {p.label}: {Math.round(p.value)}/{Math.round(p.max)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="bg-chart-track h-4 w-20 rounded-full motion-safe:animate-pulse" />
        )}
      </div>
      {live ? (
        <ChartFocusFrame focus={focus} label={label ?? title}>
          {svg}
        </ChartFocusFrame>
      ) : (
        svg
      )}
    </div>
  );
  if (!live) return body;
  return (
    <div className="flex flex-col gap-2">
      <ChartReadout
        id={focus.readoutId}
        text={focused === null ? null : parts[focused]?.readout}
      />
      {body}
    </div>
  );
};
