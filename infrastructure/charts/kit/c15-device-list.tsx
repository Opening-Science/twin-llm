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

/** The tile every row leads with: 44px, rounded, on the raised neutral surface. */
const TILE =
  "bg-muted flex h-11 min-w-11 shrink-0 items-center justify-center rounded-[10px] px-[7px]";

/**
 * The vendor's file as it is, at its size, centred on the tile. With a dark
 * version the right one shows per theme (WHOOP's white circle on the dark
 * tile, its black one on the light tile); without one the same file shows
 * in both, never recoloured.
 */
const Logo = ({ logo }: Readonly<{ logo: VendorLogo }>) => {
  const size = logo.size ?? LOGO_SIZE;
  const width = Math.round((size * logo.width) / logo.height);
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
  return logo.darkSrc ? (
    <>
      {image(logo.src, "dark:hidden")}
      {image(logo.darkSrc, "hidden dark:block")}
    </>
  ) : (
    image(logo.src)
  );
};

/**
 * The detail line, led by the vendor's attribution when it asks for one:
 * "Data by WHOOP · synced 2 hours ago".
 */
export const detailLine = (row: DeviceRow): string | null => {
  const credit =
    row.logo?.attribution && !row.hideAttribution
      ? `${row.logo.attribution} ${row.name}`
      : null;
  const parts = [credit, row.detail].filter((p): p is string => Boolean(p));
  return parts.length === 0 ? null : parts.join(" · ");
};

/** One row's content: tile, name and detail, status word, actions, chevron. */
const RowBody = ({ row }: Readonly<{ row: DeviceRow }>) => {
  const detail = detailLine(row);
  // With actions the row is not one link (a link cannot hold buttons), so
  // the name carries the link instead.
  const nameLinks = Boolean(row.href && row.actions);
  return (
    <>
      {/* Every row has a tile, so names line up; empty without a logo, never a drawn glyph. */}
      <span className={TILE}>{row.logo ? <Logo logo={row.logo} /> : null}</span>
      <span className="min-w-0 flex-1">
        {nameLinks ? (
          <Link
            href={row.href!}
            className="text-foreground block truncate font-sans underline-offset-4 hover:underline"
          >
            {row.name}
          </Link>
        ) : (
          <span className="text-foreground block truncate font-sans">{row.name}</span>
        )}
        {detail ? (
          // Wraps rather than cutting off on a phone.
          <span className="text-muted-foreground block text-xs leading-snug">
            {detail}
          </span>
        ) : null}
      </span>
      {row.status ? (
        <span className={cn("shrink-0 font-mono text-xs", STATUS_TONE[row.status.tone])}>
          {row.status.word}
        </span>
      ) : null}
      {row.actions ? (
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {row.actions}
        </span>
      ) : null}
      {row.href && !row.actions ? (
        <ChevronIcon className="text-muted-foreground" />
      ) : null}
    </>
  );
};

const ROW_BASE = "flex min-h-16 items-center gap-3 py-2.5";

/**
 * C15: a group of rows, one per device or source, with hairlines
 * between them. Each row leads with a 44px tile holding the vendor's own
 * logo, unmodified, at its size; the kit never draws a device glyph. A row
 * with `href` is a link with a chevron. The detail line wraps on a phone.
 * Loading shows row shapes; empty shows the outline of a row with what is
 * needed. A row can end in `actions` (Refresh, View, Unlink); without
 * `title` and with `framed={false}` the list sits inside a card of its own.
 */
export const DeviceList = ({
  category,
  state = "default",
  title,
  framed = true,
  rows,
  emptyNote,
  label,
}: DeviceListProps) => {
  // Framed rows keep the card's inset; frameless rows line up with their parent's content.
  const ROW = cn(ROW_BASE, framed ? "px-5" : "px-0");
  const body: ReactNode =
    state === "loading" ? (
      <ul aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className={cn(ROW, i > 0 && "border-border border-t")}>
            <span className="bg-chart-track size-11 rounded-[10px] motion-safe:animate-pulse" />
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
            {row.href && !row.actions ? (
              <Link
                href={row.href}
                className={cn(
                  ROW,
                  "hover:bg-muted focus-visible:outline-ring outline-offset-[-2px] focus-visible:outline-2",
                )}
              >
                <RowBody row={row} />
              </Link>
            ) : (
              <div className={ROW}>
                <RowBody row={row} />
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  return (
    <section
      aria-label={label ?? title ?? "Devices"}
      // Inline-size containment: long, truncated detail lines never widen a
      // grid or flex parent; the list takes the width it is given.
      className="flex flex-col gap-2 [contain:inline-size]"
      aria-busy={state === "loading" ? true : undefined}
      data-state={state}
    >
      {title ? (
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
      ) : null}
      {framed ? <div className="surface rounded-card overflow-hidden">{body}</div> : body}
    </section>
  );
};
