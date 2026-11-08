"use client";

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

export const hoursMinutes = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
};

const HEIGHT = 200;
const PLOT = 176;
const LABELS = 84;

/**
 * C09: four lanes, each with its word and its total under it, and the
 * night's stages as blocks joined by steps. The stage never depends on
 * colour alone: every lane is labelled.
 */
export const Hypnogram = ({
  state = "default",
  spans,
  labels,
  axis,
  duration = hoursMinutes,
}: HypnogramProps) => (
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
