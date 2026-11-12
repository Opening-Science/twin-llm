"use client";

import type { ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

import { useMeasuredWidth } from "../chart-frame";
import {
  categoryTextClass,
  REFERENCE_TEXT_CLASS,
  type Category,
} from "../category-token";
import { NoValue } from "./no-value";
import type { HeroValue } from "./types";

/** Pieces every kit chart shares: the measured svg, the axis word, the hero number and the loading pulse. */

/**
 * Charts draw at their real width. `height` is fixed per chart, or a
 * function of the width for a chart that grows in a wide card.
 */
export const ChartSvg = ({
  height: heightFor,
  fallback = 320,
  children,
}: {
  readonly height: number | ((width: number) => number);
  readonly fallback?: number;
  readonly children: (width: number) => ReactNode;
}) => {
  const [ref, width] = useMeasuredWidth(fallback);
  const height = typeof heightFor === "number" ? heightFor : heightFor(width);
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

/**
 * A hero number with its label and unit; today in colour, the reference grey.
 * `pair` is for two heroes side by side: a smaller step, and the unit wraps
 * under the number rather than running into the next column.
 */
export const Hero = ({
  hero,
  category,
  reference = false,
  dot = true,
  pair = false,
  missing = false,
}: {
  readonly hero: HeroValue;
  readonly category: Category;
  readonly reference?: boolean;
  readonly dot?: boolean;
  readonly pair?: boolean;
  /** No value yet: a dash that reads "no data", and the unit is not read. */
  readonly missing?: boolean;
}) => (
  <div className="min-w-0">
    <p className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
      {dot ? (
        <span
          className={cn(
            "inline-block size-2 rounded-full bg-current",
            toneClass(category, reference),
          )}
        />
      ) : null}
      {hero.label}
    </p>
    <p
      className={cn(
        "flex flex-wrap items-baseline gap-x-1 font-mono font-bold tabular-nums",
        pair ? "text-3xl" : "text-hero",
        toneClass(category, reference),
      )}
    >
      <span>{missing ? <NoValue /> : hero.value}</span>
      {hero.unit ? (
        <span
          aria-hidden={missing ? true : undefined}
          className="text-muted-foreground font-sans text-base font-normal"
        >
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
