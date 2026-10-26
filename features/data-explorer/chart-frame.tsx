"use client";

import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";

import { type Size, tooltipPosition } from "@/infrastructure/chart-tooltip";

/**
 * Shared pieces of the Data page's charts: the measured width they draw at,
 * and the hover tooltip placed beside the hovered mark.
 *
 * Charts draw at the container's real width so 11px axis text stays 11px on a
 * phone. Before the first measurement (and in the server render) they draw at
 * `fallback`, scaled to fit by the svg's `w-full`.
 */

export const useMeasuredWidth = (
  fallback: number,
): readonly [RefObject<HTMLDivElement | null>, number] => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(240, Math.floor(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};

export type HoverAnchor = Readonly<{ x: number; y: number }>;

/** A tooltip at `anchor` (CSS pixels inside the chart), measured before it shows. */
export const ChartTooltip = ({
  anchor,
  chart,
  children,
}: {
  readonly anchor: HoverAnchor | null;
  readonly chart: Size;
  readonly children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const next = { width: element.offsetWidth, height: element.offsetHeight };
    setSize((previous) =>
      previous && previous.width === next.width && previous.height === next.height
        ? previous
        : next,
    );
  }, [anchor, children]);
  if (!anchor) return null;
  const position = size ? tooltipPosition(anchor, chart, size) : null;
  return (
    <div
      ref={ref}
      className="border-border bg-popover text-popover-foreground pointer-events-none absolute top-0 left-0 z-10 w-max rounded-lg border px-3 py-2 text-xs"
      style={{
        maxWidth: Math.min(280, chart.width),
        visibility: position ? "visible" : "hidden",
        transform: position
          ? `translate(${position.left}px, ${position.top}px)`
          : undefined,
      }}
    >
      {children}
    </div>
  );
};

/** A tooltip's title line and its label/value rows. */
export const TooltipBody = ({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
}) => (
  <>
    <p className="text-foreground font-medium">{title}</p>
    <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-foreground font-mono tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  </>
);
