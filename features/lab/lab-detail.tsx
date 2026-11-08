import Link from "next/link";
import type { ReactNode } from "react";

import { LAB_LINE, LAB_TITLE, type LabPart } from "./lab-hub";

/**
 * One Lab experiment on its own page: the way back to the hub, the title,
 * one line on what it is, then the thing itself (run or open, result,
 * export). Longer explanation sits folded under "About this" at the end, so
 * the page leads with what you can do. Every Lab page uses this frame, so
 * they share one column width and one header. A page under a part, such as
 * one check (#459), names its own title and lead line and goes back to its
 * part rather than to the hub.
 */
export const LabDetail = ({
  part,
  title = LAB_TITLE[part],
  line = LAB_LINE[part],
  back = { href: "/lab", label: "Lab" },
  about,
  children,
}: Readonly<{
  part: LabPart;
  title?: string;
  line?: ReactNode;
  back?: Readonly<{ href: string; label: string }>;
  about?: ReactNode;
  children: ReactNode;
}>) => (
  <div className="page-wide page-stack">
    <header className="flex flex-col gap-2">
      <nav aria-label="Breadcrumb">
        <Link href={back.href} className="lab-back">
          <span aria-hidden>←</span> {back.label}
        </Link>
      </nav>
      <h1 className="text-display">{title}</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">{line}</p>
    </header>
    {children}
    {about === undefined ? null : (
      <details className="setup-disclosure border-border border-t pt-4">
        <summary>About this</summary>
        <div className="text-muted-foreground mt-3 flex max-w-prose flex-col gap-2 text-sm leading-relaxed">
          {about}
        </div>
      </details>
    )}
  </div>
);
