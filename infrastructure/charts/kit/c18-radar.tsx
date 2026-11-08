"use client";

import { radar } from "./kit-geometry";
import { ChartSvg, EMPTY_STROKE, LOADING_FILL, toneClass } from "./kit-parts";
import type { RadarProps } from "./types";

/**
 * In a phone-width card the width limits the radius (about 80px); a wide
 * card gets more height, so the shape grows by about a third there.
 */
export const radarHeight = (width: number): number => (width >= 400 ? 290 : 248);
/** Room beside the chart for a label and its value, two short lines. */
const ROOM = { x: 80, y: 40 };

/**
 * C18: how each part compares with the others, on three or more axes, each
 * scaled to its own maximum. Today is a filled polygon in the category
 * colour with dots at its vertices; the reference is a grey outline. Each
 * vertex carries its word and value, so nothing depends on reading the
 * shape, and a missing value is written as a dash.
 */
export const Radar = ({ category, state = "default", axes }: RadarProps) => (
  <ChartSvg height={radarHeight}>
    {(width) => {
      const out = radar(axes, { width, height: radarHeight(width) }, ROOM);
      return (
        <g data-state={state}>
          {out.rings.map((d, i) => (
            <path
              key={i}
              d={d}
              className={state === "loading" ? LOADING_FILL : "stroke-border fill-none"}
              fillOpacity={state === "loading" ? 0.6 : undefined}
            />
          ))}
          {out.spokes.map((p, i) => (
            <line
              key={i}
              x1={out.centre.x}
              y1={out.centre.y}
              x2={p.x}
              y2={p.y}
              className={state === "empty" ? EMPTY_STROKE : "stroke-border"}
              strokeDasharray={state === "empty" ? "2 4" : undefined}
            />
          ))}
          {state === "default" ? (
            <>
              {out.reference ? (
                <path
                  d={out.reference}
                  className="stroke-chart-reference fill-none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              ) : null}
              <g className={toneClass(category, false)}>
                <path
                  d={out.value}
                  className="fill-current stroke-current"
                  fillOpacity={0.2}
                  strokeWidth={3}
                  strokeLinejoin="round"
                />
                {out.points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={6}
                    className="stroke-card fill-current"
                    strokeWidth={2}
                  />
                ))}
              </g>
            </>
          ) : null}
          {out.anchors.map((a, i) => {
            const axis = axes[i]!;
            const shown = state === "default" && axis.value !== null ? axis.display : "–";
            // Two lines: the word, then the value; above the anchor at the top.
            const first = a.above ? a.y - 18 : a.y + 4;
            return (
              <text key={axis.label} x={a.x} textAnchor={a.align}>
                <tspan
                  x={a.x}
                  y={first}
                  dy="0.7em"
                  className="fill-foreground font-sans text-xs"
                >
                  {axis.label}
                </tspan>
                <tspan
                  x={a.x}
                  y={first + 15}
                  dy="0.7em"
                  className="fill-muted-foreground text-axis font-mono tabular-nums"
                >
                  {shown}
                </tspan>
              </text>
            );
          })}
        </g>
      );
    }}
  </ChartSvg>
);
