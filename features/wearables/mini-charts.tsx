import { cn } from "@/infrastructure/ui";

import { barLayout, trendPath, type MiniBox } from "./mini-chart-geometry";

/**
 * Small charts for dashboard cards. They carry no numbers of their own: the
 * card states the latest value in text, and the chart only shows the shape,
 * so it is hidden from screen readers and described by the card's caption.
 */

const BOX: MiniBox = { width: 200, height: 56, pad: 3 };

export const MiniTrend = ({
  values,
  className,
}: {
  readonly values: readonly number[];
  readonly className?: string;
}) => {
  const d = trendPath(values, BOX);
  if (!d) return null;
  return (
    <svg
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      preserveAspectRatio="none"
      className={cn("h-14 w-full", className)}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

export const MiniBars = ({
  values,
  className,
}: {
  readonly values: readonly (number | null)[];
  readonly className?: string;
}) => {
  const bars = barLayout(values, BOX, 4);
  if (bars.every((bar) => bar === null)) return null;
  return (
    <svg
      viewBox={`0 0 ${BOX.width} ${BOX.height}`}
      preserveAspectRatio="none"
      className={cn("h-14 w-full", className)}
      aria-hidden
    >
      {bars.map((bar, index) =>
        bar ? (
          <rect
            // Bars never reorder; the slot is the day.
            key={index}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={2}
            fill="currentColor"
          />
        ) : null,
      )}
    </svg>
  );
};
