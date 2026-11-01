"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { EMPTY_VALUE, formatNumber, formatUnit } from "@/infrastructure/format-measure";
import type { MapLevel } from "@/infrastructure/view-specs";

import {
  ChartTooltip,
  type HoverAnchor,
  TooltipBody,
  useMeasuredWidth,
} from "./chart-frame";
import {
  type BoundaryFeature,
  boundaryFile,
  parseBoundaries,
} from "./choropleth/boundaries";
import { binFill, binIndex, legendBins, quantileBreaks } from "./choropleth/color-scale";
import { centreLongitude, layoutMap } from "./choropleth/map-shapes";
import {
  binText,
  intervalText,
  regionLabel,
  uiText,
  valueText,
} from "./choropleth/map-text";
import {
  DEFAULT_TOP,
  mapDecimals,
  type MapRegion,
  rankRegions,
} from "./choropleth/ranking";

/**
 * A choropleth of one estimate by place: countries of the world, the
 * countries of a region, or one country's states and provinces. Our own
 * Equal Earth projection and SVG paths over the committed Natural Earth
 * boundaries, which load on demand (a country's states only when asked).
 *
 * Beside the map: the legend with units, the top places with their 95%
 * uncertainty intervals, and a table for screen readers. The ranking and
 * the table need no boundaries, so they show even if the map cannot load.
 * Places with a value are one listbox: Tab reaches it, arrows move through
 * the places by rank, and the focused place shows its tooltip.
 */

const VIEW_WIDTH = 960;
const PADDING = 8;
const MAX_HEIGHT: Readonly<Record<MapLevel, number>> = {
  world: 520,
  region: 560,
  country: 620,
};

type Loaded =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "error" }>
  | Readonly<{ state: "ready"; features: readonly BoundaryFeature[] }>;

const loads = new Map<string, Promise<readonly BoundaryFeature[] | null>>();

/**
 * One fetch per file per page; a failed fetch is tried again next time. The
 * files are this app's own static files, so nothing leaves the machine.
 */
const loadBoundaries = (file: string): Promise<readonly BoundaryFeature[] | null> => {
  const cached = loads.get(file);
  if (cached !== undefined) return cached;
  const loading = fetch(`/geo/natural-earth/${file}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((json: unknown) => (json === null ? null : parseBoundaries(json)))
    .catch(() => null)
    .then((features) => {
      if (features === null) loads.delete(file);
      return features;
    });
  loads.set(file, loading);
  return loading;
};

const useBoundaries = (country: string | null): Loaded => {
  const url = boundaryFile(country);
  const [loaded, setLoaded] = useState<Readonly<{ url: string; value: Loaded }>>({
    url,
    value: { state: "loading" },
  });
  useEffect(() => {
    let live = true;
    void loadBoundaries(url).then((features) => {
      if (!live) return;
      setLoaded({
        url,
        value: features === null ? { state: "error" } : { state: "ready", features },
      });
    });
    return () => {
      live = false;
    };
  }, [url]);
  return loaded.url === url ? loaded.value : { state: "loading" };
};

export type ChoroplethProps = Readonly<{
  title: string;
  unit: string | null;
  level: MapLevel;
  /** ISO 3166-1 alpha-3 of the country whose states are drawn; level country only. */
  country?: string | null;
  regions: readonly MapRegion[];
  /** Places named by the data that have no boundary here; listed under the map. */
  unmatched?: readonly string[];
  /** How many places the side list ranks. */
  top?: number;
}>;

type Hover = Readonly<{ code: string; anchor: HoverAnchor }>;

const tooltipRows = (
  region: MapRegion & Readonly<{ rank: number }>,
  total: number,
  unit: string | null,
  decimals: number,
): readonly (readonly [string, string])[] => {
  const interval = intervalText(region.lower, region.upper, decimals);
  return [
    ["Value", valueText(region.value, unit, decimals)],
    ...(interval === null ? [] : [["95% UI", interval] as const]),
    ["Rank", `${region.rank} of ${total}`],
  ];
};

const cell = (value: number | null, decimals: number): string =>
  value === null ? EMPTY_VALUE : formatNumber(value, decimals);

export const Choropleth = ({
  title,
  unit,
  level,
  country = null,
  regions,
  unmatched = [],
  top = DEFAULT_TOP,
}: ChoroplethProps) => {
  const id = useId();
  const hatchId = `${id}-no-data`;
  const loaded = useBoundaries(level === "country" ? country : null);
  const [frameRef, frameWidth] = useMeasuredWidth(VIEW_WIDTH);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const ranked = useMemo(() => rankRegions(regions), [regions]);
  const values = useMemo(() => ranked.map((region) => region.value), [ranked]);
  const breaks = useMemo(() => quantileBreaks(values), [values]);
  const bins = useMemo(() => legendBins(values, breaks), [values, breaks]);
  const decimals = mapDecimals(values);
  const byCode = useMemo(
    () => new Map(ranked.map((region) => [region.code, region] as const)),
    [ranked],
  );

  const layout = useMemo(() => {
    if (loaded.state !== "ready") return null;
    return layoutMap(loaded.features, {
      lon0: level === "country" ? centreLongitude(loaded.features) : 0,
      width: VIEW_WIDTH,
      padding: PADDING,
      maxHeight: MAX_HEIGHT[level],
      fitTo: level === "region" ? ranked.map((region) => region.code) : undefined,
    });
  }, [loaded, level, ranked]);

  const shapes = layout?.shapes ?? [];
  const drawn = ranked.filter((region) =>
    shapes.some((shape) => shape.code === region.code),
  );
  const scale = layout === null ? 1 : frameWidth / layout.width;
  const frame = {
    width: frameWidth,
    height: layout === null ? 0 : layout.height * scale,
  };
  const tabStop = active ?? drawn[0]?.code ?? null;

  const anchorOf = (code: string): HoverAnchor | null => {
    const shape = shapes.find((candidate) => candidate.code === code);
    return shape === undefined
      ? null
      : { x: shape.anchor[0] * scale, y: shape.anchor[1] * scale };
  };

  const shown: Hover | null =
    hover ??
    (focused && active !== null
      ? (() => {
          const anchor = anchorOf(active);
          return anchor === null ? null : { code: active, anchor };
        })()
      : null);
  const shownRegion = shown === null ? undefined : byCode.get(shown.code);
  const highlighted = shapes.find((shape) => shape.code === shown?.code);

  const focusRegion = (code: string) => {
    setActive(code);
    const target = svgRef.current?.querySelector<SVGPathElement>(
      `[data-code="${CSS.escape(code)}"]`,
    );
    target?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    const at = drawn.findIndex((region) => region.code === tabStop);
    const next = {
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      Home: 0,
      End: drawn.length - 1,
    }[event.key];
    if (event.key === "Escape") {
      setFocused(false);
      return;
    }
    if (next === undefined || drawn.length === 0) return;
    event.preventDefault();
    focusRegion(drawn[Math.min(drawn.length - 1, Math.max(0, next))].code);
  };

  const onPointer = (event: MouseEvent<SVGGElement>) => {
    const code = (event.target as Element).getAttribute("data-code");
    const box = svgRef.current?.getBoundingClientRect();
    if (code === null || box === undefined) {
      setHover(null);
      return;
    }
    setHover({
      code,
      anchor: { x: event.clientX - box.left, y: event.clientY - box.top },
    });
  };

  const onClick = (event: MouseEvent<SVGGElement>) => {
    const code = (event.target as Element).getAttribute("data-code");
    if (code !== null) focusRegion(code);
  };

  return (
    <div className="choropleth @container flex flex-col gap-3">
      <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div ref={frameRef} className="relative min-w-0">
          {layout === null ? (
            <p className="text-muted-foreground text-sm" role="status">
              {loaded.state === "error"
                ? "The map could not be loaded. The places and values are listed here."
                : "Loading the map…"}
            </p>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="h-auto w-full"
              role="group"
              aria-label={`Map: ${title}`}
            >
              <g aria-hidden="true">
                {shapes
                  .filter((shape) => !byCode.has(shape.code))
                  .map((shape) => (
                    <path
                      key={shape.code}
                      d={shape.d}
                      fill={`url(#${hatchId})`}
                      fillRule="evenodd"
                      stroke="var(--border)"
                      strokeWidth={0.6}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
              </g>
              <g
                role="listbox"
                aria-label={`Places on the map, highest value first. ${title}`}
                tabIndex={-1}
                onKeyDown={onKeyDown}
                onClick={onClick}
                onMouseMove={onPointer}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
              >
                {drawn.map((region) => {
                  const shape = shapes.find(
                    (candidate) => candidate.code === region.code,
                  );
                  return shape === undefined ? null : (
                    <path
                      key={region.code}
                      data-code={region.code}
                      role="option"
                      aria-selected={region.code === active}
                      aria-label={regionLabel(region, ranked.length, unit, decimals)}
                      tabIndex={region.code === tabStop ? 0 : -1}
                      d={shape.d}
                      fill={binFill(binIndex(region.value, breaks), breaks.length + 1)}
                      fillRule="evenodd"
                      stroke="var(--card)"
                      strokeWidth={0.6}
                      vectorEffect="non-scaling-stroke"
                      className="choropleth-region"
                      onFocus={() => setActive(region.code)}
                    />
                  );
                })}
              </g>
              {highlighted !== undefined && (
                <path
                  d={highlighted.d}
                  fill="none"
                  stroke="var(--foreground)"
                  strokeWidth={1.75}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  aria-hidden="true"
                />
              )}
            </svg>
          )}
          <ChartTooltip
            anchor={shownRegion ? (shown?.anchor ?? null) : null}
            chart={frame}
          >
            {shownRegion !== undefined && (
              <TooltipBody
                title={shownRegion.name}
                rows={tooltipRows(shownRegion, ranked.length, unit, decimals)}
              />
            )}
          </ChartTooltip>
        </div>
        <section
          aria-label="Highest values"
          className="flex min-w-0 flex-col gap-1 text-sm"
        >
          <p className="text-muted-foreground text-xs font-medium">
            Top {Math.min(top, ranked.length)} of {ranked.length}
          </p>
          <ol className="flex flex-col">
            {ranked.slice(0, top).map((region) => {
              const interval = uiText(region.lower, region.upper, decimals);
              const onMap = drawn.some((candidate) => candidate.code === region.code);
              return (
                <li key={region.code}>
                  <button
                    type="button"
                    disabled={!onMap}
                    onClick={() => focusRegion(region.code)}
                    className="hover:bg-muted flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="text-muted-foreground w-5 shrink-0 text-right font-mono text-xs tabular-nums">
                      {region.rank}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate">{region.name}</span>
                        <span className="font-mono text-xs tabular-nums">
                          {valueText(region.value, null, decimals)}
                        </span>
                      </span>
                      {interval !== null && (
                        <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                          {interval}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        aria-hidden="true"
      >
        <span className="text-muted-foreground">
          {unit === null || unit === "" ? "Value" : formatUnit(unit)}
        </span>
        {bins.map((bin) => (
          <span key={bin.index} className="flex items-center gap-1.5">
            <span
              className="border-border inline-block h-3 w-4 rounded-sm border"
              style={{ background: bin.fill }}
            />
            <span className="font-mono tabular-nums">
              {binText(bin.from, bin.to, decimals)}
            </span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <svg width={16} height={12} className="rounded-sm">
            {/* The no-data hatch; the map's places without a value use it too. */}
            <defs>
              <pattern
                id={hatchId}
                width={6}
                height={6}
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width={6} height={6} fill="var(--muted)" />
                <line
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={6}
                  stroke="var(--border)"
                  strokeWidth={2}
                />
              </pattern>
            </defs>
            <rect
              width={16}
              height={12}
              fill={`url(#${hatchId})`}
              stroke="var(--border)"
            />
          </svg>
          <span>No data</span>
        </span>
      </div>
      {unmatched.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Not on the map: {unmatched.join(", ")}
        </p>
      )}
      <table className="sr-only">
        <caption>
          {title}
          {unit === null || unit === "" ? "" : ` (${formatUnit(unit)})`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Place</th>
            <th scope="col">Value</th>
            <th scope="col">95% UI lower</th>
            <th scope="col">95% UI upper</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((region) => (
            <tr key={region.code}>
              <td>{region.rank}</td>
              <th scope="row">{region.name}</th>
              <td>{cell(region.value, decimals)}</td>
              <td>{cell(region.lower, decimals)}</td>
              <td>{cell(region.upper, decimals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
