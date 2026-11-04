import Link from "next/link";
import type { ReactNode } from "react";

import { LAB_LINE, LAB_TITLE, type LabPart } from "./lab-hub";

/**
 * One Lab experiment on its own page: the way back to the hub, the title,
 * one line on what it is, then the thing itself (run or open, result,
 * export). Longer explanation sits folded under "About this" at the end, so
 * the page leads with what you can do. Every Lab page uses this frame, so
 * they share one column width and one header.
 */
export const LabDetail = ({
  part,
  about,
  children,
}: Readonly<{ part: LabPart; about?: ReactNode; children: ReactNode }>) => (
  <div className="lab-page">
    <header className="flex flex-col gap-2">
      <nav aria-label="Breadcrumb">
        <Link href="/lab" className="lab-back">
          <span aria-hidden>←</span> Lab
        </Link>
      </nav>
      <h1 className="text-display">{LAB_TITLE[part]}</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        {LAB_LINE[part]}
      </p>
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
