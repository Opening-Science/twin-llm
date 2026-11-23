import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClassName } from "@/infrastructure/ui-kit/button";

import {
  DASHBOARD_INTRO,
  DASHBOARD_SECTIONS,
  DASHBOARD_TITLE,
  type DashboardSection,
  type DashboardSectionId,
} from "./dashboard-sections";

/**
 * `/dashboard`: a first look at the main parts of the app, one section each,
 * every section linking to the page that holds the rest. The route reads
 * what each section shows and hands it in as a slot, so this folder imports
 * no other feature. A section with nothing handed in shows its words and
 * its link.
 */

export type DashboardSlots = Readonly<Partial<Record<DashboardSectionId, ReactNode>>>;

const Section = ({
  section,
  children,
}: Readonly<{ section: DashboardSection; children: ReactNode }>) => (
  <section aria-labelledby={`dashboard-${section.id}`} className="flex flex-col gap-4">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h2
          id={`dashboard-${section.id}`}
          className="font-display text-2xl leading-tight tracking-tight"
        >
          {section.title}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
          {section.line}
        </p>
      </div>
      <Link
        href={section.href}
        className={buttonClassName({ className: "shrink-0 self-start sm:self-auto" })}
      >
        {section.linkLabel}
      </Link>
    </header>
    {children}
  </section>
);

export const DashboardScreen = ({ slots }: Readonly<{ slots: DashboardSlots }>) => (
  <div className="page-wide page-stack">
    <header className="flex flex-col gap-2">
      <h1 className="text-display">{DASHBOARD_TITLE}</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        {DASHBOARD_INTRO}
      </p>
    </header>
    {DASHBOARD_SECTIONS.map((section) => (
      <Section key={section.id} section={section}>
        {slots[section.id] ?? null}
      </Section>
    ))}
  </div>
);
