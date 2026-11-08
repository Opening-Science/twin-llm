"use client";

import type { ReactNode } from "react";

import { useMeasuredWidth } from "../chart-frame";
import {
  categoryTextClass,
  REFERENCE_TEXT_CLASS,
  type Category,
} from "../category-token";
import type { HeroValue } from "./types";

/**
 * Pieces every kit chart shares: the measured svg, the axis word, the hero
 * number and the loading pulse.
 *
 * Class lists are joined by hand rather than through `cn`: tailwind-merge
 * reads `text-axis` and `text-chart-1` as two text colours and would drop one.
 */

export const join = (...parts: readonly (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

/** Charts draw at their real width; `height` is fixed per chart. */
export const ChartSvg = ({
  height,
  fallback = 320,
  children,
}: {
  readonly height: number;
  readonly fallback?: number;
  readonly children: (width: number) => ReactNode;
}) => {
  const [ref, width] = useMeasuredWidth(fallback);
  return (
    <div ref={ref} className="w-full">
      <svg
        aria-hidden="true"
        focusable="false"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full overflow-visible"
      >
        {children(width)}
      </svg>
    </div>
  );
};

/** Axis words and callouts: mono, normal weight, tabular figures. */
export const AXIS_TEXT =
  "fill-muted-foreground font-mono text-axis font-normal tabular-nums";

/** A loading shape pulses in the track tone, unless motion is reduced. */
export const LOADING_FILL = "fill-chart-track motion-safe:animate-pulse";

/** The outline of a chart to come, in the reference grey, never filled. */
export const EMPTY_STROKE = "fill-none stroke-chart-reference";

export const toneClass = (category: Category, reference: boolean): string =>
  reference ? REFERENCE_TEXT_CLASS : categoryTextClass(category);

/** A hero number with its label and unit; today in colour, the reference grey. */
export const Hero = ({
  hero,
  category,
  reference = false,
  dot = true,
}: {
  readonly hero: HeroValue;
  readonly category: Category;
  readonly reference?: boolean;
  readonly dot?: boolean;
}) => (
  <div className="min-w-0">
    <p className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
      {dot ? (
        <span
          className={join(
            "inline-block size-2 rounded-full bg-current",
            toneClass(category, reference),
          )}
        />
      ) : null}
      {hero.label}
    </p>
    <p
      className={join(
        "text-hero font-mono font-bold tabular-nums",
        toneClass(category, reference),
      )}
    >
      {hero.value}
      {hero.unit ? (
        <span className="text-muted-foreground ml-1 font-sans text-base font-normal">
          {hero.unit}
        </span>
      ) : null}
    </p>
  </div>
);

/** A hero row in its loading shape. */
export const HeroSkeleton = () => (
  <div className="space-y-2">
    <div className="bg-chart-track h-3 w-16 rounded-full motion-safe:animate-pulse" />
    <div className="bg-chart-track h-9 w-28 rounded-lg motion-safe:animate-pulse" />
  </div>
);
