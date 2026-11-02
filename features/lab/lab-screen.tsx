import { type ReactNode } from "react";

import { CheckCard } from "./check-card";
import { JobLines } from "./job-lines";
import { type LabSection } from "./lab-check";
import { type LabJob } from "./lab-jobs";

/**
 * `/lab`: what runs on this machine, checked (Verifiability), simulated
 * recordings of synthetic people (Simulations) and evaluation and benchmark
 * results (Results). Each section has a title, a line of intro and its own
 * body; the page draws them in order.
 */

export type LabPageSection = Readonly<{
  id: string;
  title: string;
  intro: string;
  body: ReactNode;
}>;

/** The Verifiability checks as a page section, with how long they took. */
export const checksSection = (section: LabSection, job: LabJob): LabPageSection => ({
  id: section.id,
  title: section.title,
  intro: section.intro,
  body: (
    <div className="flex flex-col gap-4">
      <JobLines jobs={[job]} refresh={false} />
      {section.checks.map((check) => (
        <CheckCard key={check.id} check={check} />
      ))}
    </div>
  ),
});

export const LabScreen = ({
  sections,
}: Readonly<{ sections: readonly LabPageSection[] }>) => (
  <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-10 sm:px-6">
    <header className="flex flex-col gap-3">
      <h1 className="text-display">Lab</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        TwinLLM runs on this machine, so what it claims about itself can be checked here
        and repeated by hand. For research use only; nothing on this page is about
        anyone&rsquo;s health.
      </p>
      <nav aria-label="Lab sections">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="setup-link">
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
    {sections.map((section) => (
      <section
        key={section.id}
        id={section.id}
        aria-labelledby={`lab-section-${section.id}`}
        className="flex min-w-0 scroll-mt-6 flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <h2 id={`lab-section-${section.id}`} className="text-xl font-medium">
            {section.title}
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
            {section.intro}
          </p>
        </div>
        {section.body}
      </section>
    ))}
  </div>
);
