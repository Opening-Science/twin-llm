"use client";

import { conditionToken, type SeriesToken, tokenTextClass } from "../category-token";
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
  nullBand,
  nullFigure,
  seriesKeys,
  spacedTicks,
  type AxisScale,
  type Estimate,
} from "./kit-geometry";
import { AXIS_TEXT, ChartSvg, EMPTY_STROKE, LOADING_FILL, toneClass } from "./kit-parts";
import type { ResearchFigureProps } from "./types";

const AXIS = 22;
/** Room at either end of the plot, so a dot at 0 or 1 clears its row label. */
const PAD = 8;

const fixed = (value: number, decimals: number): string => value.toFixed(decimals);

/** A tick on a log axis reads as the ratio itself: 0.5, 1, 2, 4. */
const ratio = (value: number): string => String(Number(value.toPrecision(3)));

/**
 * The legend under a figure whose rows are grouped by series, and the
 * expected tick when rows carry one. Colour is never the only signal: each
 * series is named here, and each row names its own condition.
 */
const Legend = ({
  series,
  expected,
}: Readonly<{ series: readonly string[]; expected: boolean }>) =>
  series.length === 0 && !expected ? null : (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
      {series.map((name, i) => (
        <li key={name} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block size-2.5 rounded-full bg-current ${tokenTextClass(conditionToken(i))}`}
          />
          {name}
        </li>
      ))}
      {expected ? (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="bg-chart-reference inline-block h-3 w-0.5"
          />
          Expected
        </li>
      ) : null}
    </ul>
  );

/**
 * Rows of estimates with whiskers on one axis. A row's colour comes from its
 * `series` when it has one (every row of a series shares it, and a legend
 * names them), else from `tone`. An expected value is a grey tick on its
 * row. With readouts, the row under the pointer or the keys stays full, the
 * others step back, and the readout names it.
 */
const EstimatePlot = ({
  estimates,
  reference,
  domain,
  scale = "linear",
  seriesOrder,
  tone,
  state,
  label,
  defaultFocus,
}: {
  readonly estimates: readonly Estimate[];
  readonly reference?: Readonly<{ value: number; label: string }>;
  readonly domain?: readonly [number, number];
  readonly scale?: AxisScale;
  readonly tone: (index: number) => string;
  readonly state: "default" | "loading" | "empty";
  readonly label?: string;
  readonly defaultFocus?: number;
  readonly seriesOrder?: readonly string[];
}) => {
  const keys = seriesKeys(estimates, seriesOrder);
  const hasExpected = estimates.some(
    (e) => e.expected !== undefined && e.expected !== null,
  );
  const rowTone = (i: number): string => {
    const key = estimates[i]?.series;
    return key ? tokenTextClass(conditionToken(keys.indexOf(key))) : tone(i);
  };
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
          scale,
          PAD,
          seriesOrder,
        );
        const decimals = exactDecimals(out.ticks.map((t) => t.value));
        const tickLabel = (value: number): string =>
          scale === "log" ? ratio(value) : fixed(value, decimals);
        // Stacked: the label sits above its row and the marks a little below it.
        const markY = layout.stacked ? 8 : 0;
        return (
          <g data-state={state}>
            {/* The reference is a dotted segment through each row's marks,
                under them, never across a label: in a narrow card the labels
                sit above the marks, on the line's path. */}
            {out.referenceX !== null && reference && state === "default"
              ? out.rows.map((row) => (
                  <line
                    key={`ref-${row.label}`}
                    x1={layout.left + out.referenceX!}
                    x2={layout.left + out.referenceX!}
                    y1={top + row.y + (layout.stacked ? 8 : 0) - 12}
                    y2={top + row.y + (layout.stacked ? 8 : 0) + 12}
                    className="stroke-chart-reference"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                ))
              : null}
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
                    <g className={rowTone(i)}>
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
                      {/* On top of the dot and taller than it, so it shows when the two nearly meet. */}
                      {row.expected !== null ? (
                        <line
                          x1={row.expected}
                          x2={row.expected}
                          y1={-11}
                          y2={11}
                          className="stroke-chart-reference"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      ) : null}
                    </g>
                  )}
                </g>
              </g>
            ))}
            <g transform={`translate(${layout.left} 0)`}>
              {out.referenceX !== null && reference && state === "default" ? (
                <>
                  <text
                    x={out.referenceX}
                    y={10}
                    textAnchor={edgeAnchor(out.referenceX, plotWidth)}
                    // The card-coloured outline keeps its own dotted line out of the words.
                    className={`${AXIS_TEXT} stroke-card`}
                    strokeWidth={4}
                    paintOrder="stroke"
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
                  {tickLabel(t.value)}
                </text>
              ))}
            </g>
          </g>
        );
      }}
    </ChartSvg>
  );
  const legend =
    state === "default" ? <Legend series={keys} expected={hasExpected} /> : null;
  if (!live) {
    return legend ? (
      <div className="flex flex-col gap-2">
        {chart}
        {legend}
      </div>
    ) : (
      chart
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ChartReadout
        id={focus.readoutId}
        text={focused === null ? null : estimates[focused]?.readout}
      />
      <ChartFocusFrame focus={focus} label={label ?? "Estimates"}>
        {chart}
      </ChartFocusFrame>
      {legend}
    </div>
  );
};

/**
 * R1, a research figure in the kit's style, in one of three kinds:
 * estimates with interval whiskers across conditions against a reference;
 * a pair of estimates (such as sensitivity and specificity) per dataset; an
 * observed value against a null distribution, given as its draws or as a
 * summary. `series` colours a figure by a study series rather than a
 * wearable category.
 */
export const ResearchFigure = (props: ResearchFigureProps) => {
  const state = props.state ?? "default";
  const single: SeriesToken | undefined = props.series;
  if (props.kind === "estimates") {
    return (
      <EstimatePlot
        estimates={props.estimates}
        reference={props.reference}
        domain={props.domain}
        scale={props.scale}
        seriesOrder={props.seriesOrder}
        tone={(i) => tokenTextClass(single ?? conditionToken(i))}
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
  const observedTone = single ? tokenTextClass(single) : toneClass(props.category, false);
  const { summary } = props;
  return (
    <ChartSvg height={140}>
      {(width) => {
        const draws = state === "default" && !summary ? (props.draws ?? []) : [];
        const out = nullFigure(draws, props.observed, { width, height: 96 }, 24);
        const band = summary
          ? nullBand(summary, props.observed, { width, height: 96 })
          : null;
        const observedX = band ? band.observedX : out.observedX;
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
                {band ? (
                  <>
                    {/* The null's interval as a grey band, its mean as a tick. */}
                    <rect
                      x={band.low}
                      y={44}
                      width={Math.max(2, band.high - band.low)}
                      height={40}
                      rx={6}
                      className="fill-chart-reference"
                      fillOpacity={0.35}
                    />
                    <line
                      x1={band.mean}
                      x2={band.mean}
                      y1={40}
                      y2={88}
                      className="stroke-chart-reference"
                      strokeWidth={2}
                    />
                    {props.nullLabel ? (
                      <text
                        x={band.mean}
                        y={104}
                        textAnchor={edgeAnchor(band.mean, width, 80)}
                        className={AXIS_TEXT}
                      >
                        {props.nullLabel}
                      </text>
                    ) : null}
                  </>
                ) : (
                  out.bars.map((b, i) => (
                    <rect key={i} {...b} rx={2} className="fill-chart-reference" />
                  ))
                )}
                <g className={observedTone}>
                  <line
                    x1={observedX}
                    x2={observedX}
                    y1={-8}
                    y2={96}
                    className="stroke-current"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                  <text
                    x={observedX}
                    y={-10}
                    textAnchor={edgeAnchor(observedX, width, 80)}
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
