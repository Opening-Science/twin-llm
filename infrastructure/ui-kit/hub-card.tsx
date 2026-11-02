import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

import { StatusBadge, type StatusTone } from "./status-badge";

/**
 * A hub of cards, each opening its own page: a title, one line on what it is
 * and a short meta line (a state, a count, a date). Nothing else goes on a
 * card; detail lives on the page it opens. A list, so a screen reader hears
 * how many there are, and each card is one link with the title as its name.
 * The look lives in `globals.css` under "Hub cards".
 */

export const HubGrid = ({
  label,
  className,
  children,
}: Readonly<{ label: string; className?: string; children: ReactNode }>) => (
  <ul aria-label={label} className={cn("hub-grid", className)}>
    {children}
  </ul>
);

export type HubCardProps = Readonly<{
  href: string;
  title: string;
  line: string;
  meta: string;
  /** Colours the meta line's dot; the words always say the state. */
  tone?: StatusTone;
}>;

export const HubCard = ({ href, title, line, meta, tone = "neutral" }: HubCardProps) => (
  <li className="flex">
    <Link href={href} className="hub-card">
      <span className="text-base font-medium">{title}</span>
      <span className="text-muted-foreground text-sm leading-relaxed">{line}</span>
      <StatusBadge tone={tone} className="mt-auto pt-2 font-normal">
        {meta}
      </StatusBadge>
    </Link>
  </li>
);
