"use client";

import { ChartFocusFrame, ChartReadout, dimmed, useChartFocus } from "./chart-focus";
import { formatDuration } from "./format";
import { hypnogram, STAGE_LANES, type SleepStage } from "./kit-geometry";
import { AXIS_TEXT, ChartSvg, EMPTY_STROKE, LOADING_FILL } from "./kit-parts";
import type { HypnogramProps } from "./types";

const LANE_WORDS: Readonly<Record<SleepStage, string>> = {
  awake: "Awake",
  rem: "REM",
  core: "Core",
  deep: "Deep",
};

/** Written out so Tailwind finds every class. */
const STAGE_FILL: Readonly<Record<SleepStage, string>> = {
  awake: "fill-stage-awake",
  rem: "fill-stage-rem",
  core: "fill-stage-core",
  deep: "fill-stage-deep",
};

/** A stage's length, the kit's way ("7 hr 4 min"); a negative total counts as none. */
export const hoursMinutes = (minutes: number): string =>
  formatDuration(Math.max(0, minutes));

const HEIGHT = 200;
const PLOT = 176;
const LABELS = 84;

/**
 * C09: four lanes, each with its word and its total under it, and the
 * night's stages as blocks joined by steps. The stage never depends on
 * colour alone: every lane is labelled. With readouts, a click or tap pins
 * a block (again to clear), hover previews the block at that time, and the
 * arrow keys step through the night; the readout names the focused block.
 */
export const Hypnogram = ({
  state = "default",
  spans,
  labels,
  axis,
  duration = hoursMinutes,
  label,
  defaultFocus,
}: HypnogramProps) => {
  // The blocks in time order; their order does not depend on the width.
  const order = hypnogram(spans, { width: 1, height: 1 }).blocks;
  const live = state === "default" && order.some((b) => b.readout);
  const focus = useChartFocus({
    count: order.length,
    axis: "both",
    tap: true,
    defaultFocus,
    // Between blocks, the block at that time of night.
    pick: (x, _y, width) => {
      const at = x - LABELS;
      const blocks = hypnogram(spans, {
        width: Math.max(40, width - LABELS),
        height: PLOT,
      }).blocks;
      const index = blocks.findIndex((b) => at >= b.x && at <= b.x + b.width);
      return index < 0 ? null : index;
    },
  });
  const focused = live ? focus.index : null;
  const chart = (
    <ChartSvg height={HEIGHT}>
      {(width) => {
        const plotWidth = Math.max(40, width - LABELS);
        const out = hypnogram(state === "default" ? spans : [], {
          width: plotWidth,
          height: PLOT,
        });
        return (
          <g data-state={state}>
            {STAGE_LANES.map((stage) => (
              <g key={stage} transform={`translate(0 ${out.laneY[stage]})`}>
                <text y={14} className="fill-foreground font-sans text-sm">
                  {labels?.[stage] ?? LANE_WORDS[stage]}
                </text>
                {state === "default" ? (
                  <text y={30} className={AXIS_TEXT}>
                    {duration(out.minutes[stage])}
                  </text>
                ) : null}
                {state !== "default" ? (
                  <rect
                    x={LABELS}
                    y={2}
                    width={plotWidth}
                    height={out.laneHeight - 4}
                    rx={(out.laneHeight - 4) / 2}
                    className={state === "loading" ? LOADING_FILL : EMPTY_STROKE}
                    strokeDasharray={state === "empty" ? "2 6" : undefined}
                  />
                ) : null}
              </g>
            ))}
            <g transform={`translate(${LABELS} 0)`}>
              <path d={out.steps} className="stroke-muted-foreground" strokeWidth={1} />
              {out.blocks.map((b, i) => (
                <rect
                  key={i}
                  x={b.x}
                  y={b.y + 4}
                  width={b.width}
                  height={b.height - 8}
                  rx={4}
                  className={STAGE_FILL[b.stage]}
                  fillOpacity={dimmed(focused, i)}
                  data-focus-index={live ? i : undefined}
                />
              ))}
            </g>
            {axis ? (
              <>
                <text x={LABELS} y={HEIGHT - 2} className={AXIS_TEXT}>
                  {axis[0]}
                </text>
                <text x={width} y={HEIGHT - 2} textAnchor="end" className={AXIS_TEXT}>
                  {axis[1]}
                </text>
              </>
            ) : null}
          </g>
        );
      }}
    </ChartSvg>
  );
  if (!live) return chart;
  return (
    <div className="flex flex-col gap-2">
      <ChartReadout
        id={focus.readoutId}
        text={focused === null ? null : order[focused]?.readout}
      />
      <ChartFocusFrame focus={focus} label={label ?? "Sleep stages"}>
        {chart}
      </ChartFocusFrame>
    </div>
  );
};
