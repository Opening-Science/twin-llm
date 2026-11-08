import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/infrastructure/ui";
import { ChevronIcon } from "@/infrastructure/ui-kit/icons";

import { categoryTextClass } from "../category-token";
import type { DeviceListProps, DeviceRow, VendorLogo } from "./types";

/** Logos are sized by height; the width follows the file's own proportions. */
const LOGO_HEIGHT = 20;

const STATUS_TONE: Readonly<Record<NonNullable<DeviceRow["status"]>["tone"], string>> = {
  ok: "text-winner",
  warn: "text-destructive",
  neutral: "text-muted-foreground",
};

/**
 * The vendor's file as it is, on a card-coloured tile. With a dark version
 * the right one shows per theme; without one the same file shows in both.
 */
const Logo = ({ logo }: Readonly<{ logo: VendorLogo }>) => {
  const width = Math.round((LOGO_HEIGHT * logo.width) / logo.height);
  const image = (src: string, className?: string) => (
    <Image
      src={src}
      alt={logo.alt}
      width={width}
      height={LOGO_HEIGHT}
      unoptimized
      className={cn("h-5 w-auto", className)}
    />
  );
  return (
    <span className="bg-card border-border flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border px-2">
      {logo.darkSrc ? (
        <>
          {image(logo.src, "dark:hidden")}
          {image(logo.darkSrc, "hidden dark:block")}
        </>
      ) : (
        image(logo.src)
      )}
    </span>
  );
};

/** One row's content: logo tile, name and detail, status word, chevron. */
const RowBody = ({ row, tile }: Readonly<{ row: DeviceRow; tile: boolean }>) => (
  <>
    {row.logo ? (
      <Logo logo={row.logo} />
    ) : tile ? (
      // Keeps the names aligned when other rows have a logo; never a drawn glyph.
      <span aria-hidden="true" className="bg-muted size-10 shrink-0 rounded-lg" />
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

const ROW = "flex min-h-16 items-center gap-3 px-5 py-3";

/**
 * C15: a titled group of rows, one per device or source, with hairlines
 * between them. A row with `href` is a link with a chevron. A logo is the
 * vendor's own file, unmodified, sized by height on a card-coloured tile;
 * the kit never draws a device glyph. Loading shows row shapes; empty
 * shows the outline of a row with what is needed.
 */
export const DeviceList = ({
  category,
  state = "default",
  title,
  rows,
  emptyNote,
}: DeviceListProps) => {
  const tile = rows.some((r) => r.logo);
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
      className="flex flex-col gap-2"
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
