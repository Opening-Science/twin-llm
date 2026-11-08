"use client";

import { conditionToken, tokenTextClass } from "../category-token";
import {
  ChartFocusFrame,
  ChartReadout,
  dimmed,
  mutedUnlessFocused,
  useChartFocus,
} from "./chart-focus";
import {
  edgeAnchor,
  estimateLayout,
  estimateRows,
  exactDecimals,
  nullFigure,
  spacedTicks,
  type Estimate,
} from "./kit-geometry";
import { AXIS_TEXT, ChartSvg, EMPTY_STROKE, LOADING_FILL, toneClass } from "./kit-parts";
import type { ResearchFigureProps } from "./types";

const AXIS = 22;

const fixed = (value: number, decimals: number): string => value.toFixed(decimals);

/**
 * Rows of estimates with whiskers on one axis; colour per row from `tone`.
 * With readouts, the row under the pointer or the keys stays full, the
 * others step back, and the readout names it.
 */
const EstimatePlot = ({
  estimates,
  reference,
  domain,
  tone,
  state,
  label,
  defaultFocus,
}: {
  readonly estimates: readonly Estimate[];
  readonly reference?: Readonly<{ value: number; label: string }>;
  readonly domain?: readonly [number, number];
  readonly tone: (index: number) => string;
  readonly state: "default" | "loading" | "empty";
  readonly label?: string;
  readonly defaultFocus?: number;
}) => {
  const top = reference ? 16 : 0;
  const heightFor = (width: number): number =>
    Math.max(1, estimates.length) * estimateLayout(width).row + AXIS + top;
  const live = state === "default" && estimates.some((e) => e.readout);
  const focus = useChartFocus({
    count: estimates.length,
    axis: "both",
    pick: (_x, y, width) => {
      const index = Math.floor((y - top) / estimateLayout(width).row);
      return index >= 0 && index < estimates.length ? index : null;
    },
    defaultFocus,
  });
  const focused = live ? focus.index : null;
  const chart = (
    <ChartSvg height={heightFor}>
      {(width) => {
        const layout = estimateLayout(width);
        const height = heightFor(width);
        const plotWidth = layout.plot;
        const out = estimateRows(
          estimates,
          { width: plotWidth, height: estimates.length * layout.row },
          reference?.value ?? null,
          domain,
        );
        const decimals = exactDecimals(out.ticks.map((t) => t.value));
        // Stacked: the label sits above its row and the marks a little below it.
        const markY = layout.stacked ? 8 : 0;
        return (
          <g data-state={state}>
            {out.rows.map((row, i) => (
              <g key={row.label} transform={`translate(0 ${top + row.y})`}>
                <text
                  x={layout.stacked ? layout.left : 0}
                  y={layout.stacked ? -8 : 4}
                  // A card-coloured outline keeps the word clear of the reference line.
                  className={
                    mutedUnlessFocused(focused, i)
                      ? "fill-muted-foreground stroke-card font-sans text-sm"
                      : "fill-foreground stroke-card font-sans text-sm"
                  }
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {row.label}
                </text>
                <g
                  transform={`translate(${layout.left} ${markY})`}
                  opacity={dimmed(focused, i)}
                >
                  {state === "loading" ? (
                    <rect
                      x={0}
                      y={-6}
                      width={plotWidth * 0.6}
                      height={12}
                      rx={6}
                      className={LOADING_FILL}
                    />
                  ) : state === "empty" ? (
                    <rect
                      x={0}
                      y={-6}
                      width={plotWidth}
                      height={12}
                      rx={6}
                      className={EMPTY_STROKE}
                      strokeDasharray="2 6"
                    />
                  ) : (
                    <g className={tone(i)}>
                      {row.low !== null && row.high !== null ? (
                        <line
                          x1={row.low}
                          x2={row.high}
                          y1={0}
                          y2={0}
                          pathLength={1}
                          className="kit-draw stroke-current"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      ) : null}
                      <circle
                        cx={row.x}
                        cy={0}
                        r={6}
                        className="stroke-card fill-current"
                        strokeWidth={2}
                      />
                    </g>
                  )}
                </g>
              </g>
            ))}
            <g transform={`translate(${layout.left} 0)`}>
              {out.referenceX !== null && reference && state === "default" ? (
                <>
                  <line
                    x1={out.referenceX}
                    x2={out.referenceX}
                    y1={top - 4}
                    y2={top + estimates.length * layout.row}
                    className="stroke-chart-reference"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={out.referenceX}
                    y={10}
                    textAnchor={edgeAnchor(out.referenceX, plotWidth)}
                    className={AXIS_TEXT}
                  >
                    {reference.label}
                  </text>
                </>
              ) : null}
              {spacedTicks(out.ticks).map((t) => (
                <text
                  key={t.value}
                  x={t.x}
                  y={height - 2}
                  textAnchor="middle"
                  className={AXIS_TEXT}
                >
                  {fixed(t.value, decimals)}
                </text>
              ))}
            </g>
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
        text={focused === null ? null : estimates[focused]?.readout}
      />
      <ChartFocusFrame focus={focus} label={label ?? "Estimates"}>
        {chart}
      </ChartFocusFrame>
    </div>
  );
};

/**
 * R1, a research figure in the kit's style, in one of three kinds:
 * estimates with interval whiskers across conditions against a reference;
 * a pair of estimates (such as sensitivity and specificity) per dataset; an
 * observed value against a null distribution.
 */
export const ResearchFigure = (props: ResearchFigureProps) => {
  const state = props.state ?? "default";
  if (props.kind === "estimates") {
    return (
      <EstimatePlot
        estimates={props.estimates}
        reference={props.reference}
        domain={props.domain}
        tone={(i) => tokenTextClass(conditionToken(i))}
        state={state}
        label={props.label}
        defaultFocus={props.defaultFocus}
      />
    );
  }
  if (props.kind === "pairs") {
    // Each dataset's two estimates take the first two series, the same in every group.
    const rows = props.groups.flatMap((g) =>
      g.estimates.map((e) => ({ ...e, label: `${g.label} · ${e.label}` })),
    );
    return (
      <EstimatePlot
        estimates={rows}
        domain={[0, 1]}
        tone={(i) => tokenTextClass(conditionToken(i % 2))}
        state={state}
        label={props.label}
        defaultFocus={props.defaultFocus}
      />
    );
  }
  const format = props.format ?? ((v: number) => v.toFixed(2));
  return (
    <ChartSvg height={140}>
      {(width) => {
        const out = nullFigure(
          state === "default" ? props.draws : [],
          props.observed,
          { width, height: 96 },
          24,
        );
        return (
          <g data-state={state} transform="translate(0 20)">
            {state === "loading" ? (
              <rect
                x={0}
                y={32}
                width={width}
                height={64}
                rx={12}
                className={LOADING_FILL}
              />
            ) : state === "empty" ? (
              <rect
                x={0}
                y={32}
                width={width}
                height={64}
                rx={12}
                className={EMPTY_STROKE}
                strokeDasharray="2 6"
              />
            ) : (
              <>
                {out.bars.map((b, i) => (
                  <rect key={i} {...b} rx={2} className="fill-chart-reference" />
                ))}
                <g className={toneClass(props.category, false)}>
                  <line
                    x1={out.observedX}
                    x2={out.observedX}
                    y1={-8}
                    y2={96}
                    className="stroke-current"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                  <text
                    x={out.observedX}
                    y={-10}
                    textAnchor={edgeAnchor(out.observedX, width, 80)}
                    className="text-axis fill-current font-mono tabular-nums"
                  >
                    {props.observedLabel} {format(props.observed)}
                  </text>
                </g>
              </>
            )}
          </g>
        );
      }}
    </ChartSvg>
  );
};
