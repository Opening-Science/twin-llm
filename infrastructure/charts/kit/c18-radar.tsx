"use client";

import { EMPTY_VALUE } from "@/infrastructure/format-measure";

import {
  ChartFocusFrame,
  ChartGroup,
  ChartReadout,
  dimmed,
  mutedUnlessFocused,
  useChartFocus,
} from "./chart-focus";
import { invertedNote, radar, radarAxisAt } from "./kit-geometry";
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
 * shape, and a missing value is written as a dash. With readouts, a click or
 * tap pins the axis nearest the pointer (again to clear), hover previews it
 * and the arrow keys step round; the other vertices step back and the
 * readout names the focused one.
 */
export const Radar = ({
  category,
  state = "default",
  axes,
  label,
  defaultFocus,
}: RadarProps) => {
  const live = state === "default" && axes.length >= 3 && axes.some((a) => a.readout);
  const focus = useChartFocus({
    count: axes.length,
    axis: "both",
    tap: true,
    defaultFocus,
    pick: (x, y, width, height) =>
      radarAxisAt(x - width / 2, y - height / 2, axes.length),
  });
  const focused = live ? focus.index : null;
  const chart = (
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
                className={
                  state === "empty"
                    ? EMPTY_STROKE
                    : i === focused
                      ? `stroke-current ${toneClass(category, false)}`
                      : "stroke-border"
                }
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
                      r={i === focused ? 8 : 6}
                      className="stroke-card fill-current"
                      fillOpacity={dimmed(focused, i)}
                      strokeWidth={2}
                      data-focus-index={live ? i : undefined}
                    />
                  ))}
                </g>
              </>
            ) : null}
            {out.anchors.map((a, i) => {
              const axis = axes[i]!;
              const shown =
                state === "default" && axis.value !== null ? axis.display : EMPTY_VALUE;
              // Two lines: the word, then the value; above the anchor at the top.
              const first = a.above ? a.y - 18 : a.y + 4;
              return (
                <text
                  key={axis.label}
                  x={a.x}
                  textAnchor={a.align}
                  data-focus-index={live ? i : undefined}
                >
                  <tspan
                    x={a.x}
                    y={first}
                    dy="0.7em"
                    className={
                      mutedUnlessFocused(focused, i)
                        ? "fill-muted-foreground font-sans text-xs"
                        : "fill-foreground font-sans text-xs"
                    }
                  >
                    {axis.label}
                  </tspan>
                  <tspan
                    x={a.x}
                    y={first + 15}
                    dy="0.7em"
                    className={
                      focused === i
                        ? "fill-foreground text-axis font-mono tabular-nums"
                        : "fill-muted-foreground text-axis font-mono tabular-nums"
                    }
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
  // Inverted axes always come with a plain note, so further out is never read as higher.
  const note = state === "default" ? invertedNote(axes) : null;
  const name = label ?? "Parts compared";
  const noted = note ? <p className="text-muted-foreground text-xs">{note}</p> : null;
  if (!live) {
    return (
      <ChartGroup label={name} className={noted ? "flex flex-col gap-2" : undefined}>
        {chart}
        {noted}
      </ChartGroup>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ChartReadout
        id={focus.readoutId}
        text={focused === null ? null : axes[focused]?.readout}
      />
      <ChartFocusFrame focus={focus} label={name}>
        {chart}
      </ChartFocusFrame>
      {noted}
    </div>
  );
};
