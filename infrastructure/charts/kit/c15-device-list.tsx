import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/infrastructure/ui";
import { ChevronIcon } from "@/infrastructure/ui-kit/icons";

import { categoryTextClass } from "../category-token";
import type { DeviceListProps, DeviceRow, VendorLogo } from "./types";

/** WHOOP's minimum; other vendors give none or a smaller one. */
const LOGO_SIZE = 30;

const STATUS_TONE: Readonly<Record<NonNullable<DeviceRow["status"]>["tone"], string>> = {
  ok: "text-winner",
  warn: "text-destructive",
  neutral: "text-muted-foreground",
};

/** The box a logo takes with its clear space: half its size on every side. */
export const logoBox = (
  logo: VendorLogo,
): Readonly<{ width: number; height: number; clear: number }> => {
  const size = logo.size ?? LOGO_SIZE;
  const clear = size / 2;
  return {
    width: Math.round((size * logo.width) / logo.height) + 2 * clear,
    height: size + 2 * clear,
    clear,
  };
};

/**
 * The vendor's file as it is, with nothing inside its clear space: no
 * border, no tile, only the card behind it. With a dark version the right
 * one shows per theme; without one the same file shows in both. The
 * attribution word sits before it, outside the clear space.
 */
const Logo = ({ logo }: Readonly<{ logo: VendorLogo }>) => {
  const size = logo.size ?? LOGO_SIZE;
  const width = Math.round((size * logo.width) / logo.height);
  const { clear } = logoBox(logo);
  const image = (src: string, className?: string) => (
    <Image
      src={src}
      alt={logo.alt}
      width={width}
      height={size}
      unoptimized
      className={cn("block max-w-none", className)}
      style={{ width, height: size }}
    />
  );
  return (
    <span className="flex shrink-0 items-center">
      {logo.attribution ? (
        <span className="text-muted-foreground font-mono text-xs">
          {logo.attribution}
        </span>
      ) : null}
      <span className="flex shrink-0 items-center" style={{ padding: clear }}>
        {logo.darkSrc ? (
          <>
            {image(logo.src, "dark:hidden")}
            {image(logo.darkSrc, "hidden dark:block")}
          </>
        ) : (
          image(logo.src)
        )}
      </span>
    </span>
  );
};

/** One row's content: logo tile, name and detail, status word, chevron. */
const RowBody = ({ row, tile }: Readonly<{ row: DeviceRow; tile: number }>) => (
  <>
    {row.logo ? (
      <Logo logo={row.logo} />
    ) : tile ? (
      // Keeps the names aligned when other rows have a logo; never a drawn glyph.
      <span aria-hidden="true" className="shrink-0" style={{ width: tile }} />
    ) : null}
    <span className="min-w-0 flex-1">
      <span className="text-foreground block truncate font-sans">{row.name}</span>
      {row.detail ? (
        <span className="text-muted-foreground block truncate text-xs">{row.detail}</span>
      ) : null}
    </span>
    {row.status ? (
      <span className={cn("shrink-0 font-mono text-xs", STATUS_TONE[row.status.tone])}>
        {row.status.word}
      </span>
    ) : null}
    {row.href ? <ChevronIcon className="text-muted-foreground" /> : null}
  </>
);

/** Little vertical padding: a logo's own clear space fills the row's height. */
const ROW = "flex min-h-16 items-center gap-3 px-5 py-1";

/**
 * C15: a titled group of rows, one per device or source, with hairlines
 * between them. A row with `href` is a link with a chevron. A logo is the
 * vendor's own file, unmodified, at its size with clear space and only the
 * card behind it; the kit never draws a device glyph. Loading shows row shapes; empty
 * shows the outline of a row with what is needed.
 */
export const DeviceList = ({
  category,
  state = "default",
  title,
  rows,
  emptyNote,
}: DeviceListProps) => {
  // The widest logo box among rows without an attribution word sets the
  // spacer for rows without a logo, so names line up; 0 when none has one.
  const tile = Math.max(
    0,
    ...rows.flatMap((r) =>
      r.logo && !r.logo.attribution ? [logoBox(r.logo).width] : [],
    ),
  );
  const body: ReactNode =
    state === "loading" ? (
      <ul aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className={cn(ROW, i > 0 && "border-border border-t")}>
            <span className="bg-chart-track size-10 rounded-lg motion-safe:animate-pulse" />
            <span className="bg-chart-track h-4 w-1/3 rounded-full motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>
    ) : state === "empty" ? (
      <p
        className={cn(
          ROW,
          "border-chart-reference text-muted-foreground m-3 rounded-lg border border-dashed text-sm",
        )}
      >
        {emptyNote ?? " "}
      </p>
    ) : (
      <ul>
        {rows.map((row, i) => (
          <li key={row.name} className={cn(i > 0 && "border-border border-t")}>
            {row.href ? (
              <Link
                href={row.href}
                className={cn(
                  ROW,
                  "hover:bg-muted focus-visible:outline-ring outline-offset-[-2px] focus-visible:outline-2",
                )}
              >
                <RowBody row={row} tile={tile} />
              </Link>
            ) : (
              <div className={ROW}>
                <RowBody row={row} tile={tile} />
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  return (
    <section
      // Inline-size containment: long, truncated detail lines never widen a
      // grid or flex parent; the list takes the width it is given.
      className="flex flex-col gap-2 [contain:inline-size]"
      aria-busy={state === "loading" ? true : undefined}
      data-state={state}
    >
      <h3 className="text-foreground flex items-center gap-2 font-sans font-bold">
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-2.5 rounded-full bg-current",
            categoryTextClass(category),
          )}
        />
        {title}
      </h3>
      <div className="surface rounded-card overflow-hidden">{body}</div>
    </section>
  );
};
