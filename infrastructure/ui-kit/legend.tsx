import { cn } from "@/infrastructure/ui";

/**
 * Which colour is which series.
 *
 * Only the swatch carries the series colour; the label stays in the
 * foreground colour. Chart colours are tuned for 3:1 against the card, the
 * bar for a line or a dot, not the 4.5:1 a line of text needs, so colouring
 * the label itself would make it harder to read.
 *
 * A fixed colour that is not a theme token (the 3D overlays) comes in as
 * `swatchColor`. Nothing checks its contrast against the card, so that swatch
 * gets a hairline ring and a pale colour stays visible in the light theme.
 */

export type LegendItem = Readonly<{
  id: string;
  label: string;
  /** A text colour class, e.g. `text-chart-1`; the swatch draws in `currentColor`. */
  swatchClassName?: string;
  /** A fixed CSS colour, set inline as `currentColor`, for colours with no token. */
  swatchColor?: string;
}>;

export type LegendProps = Readonly<{
  items: readonly LegendItem[];
  className?: string;
}>;

export const Legend = ({ items, className }: LegendProps) => (
  <ul className={cn("flex flex-wrap gap-4", className)}>
    {items.map((item) => (
      <li key={item.id} className="text-foreground flex items-center gap-1.5 text-xs">
        <span
          className={cn(
            "size-2 rounded-full bg-current",
            item.swatchColor && "ring-border ring-1",
            item.swatchClassName,
          )}
          style={item.swatchColor ? { color: item.swatchColor } : undefined}
          aria-hidden
        />
        {item.label}
      </li>
    ))}
  </ul>
);
