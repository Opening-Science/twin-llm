import { CheckCard } from "./check-card";
import { type LabSection } from "./lab-check";

/**
 * `/lab`: checks of what runs on this machine, grouped in sections. Only
 * Verifiability exists so far; a later section is one more entry in
 * `sections`, drawn the same way.
 */

export const LabScreen = ({
  sections,
}: Readonly<{ sections: readonly LabSection[] }>) => (
  <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
    <header className="flex flex-col gap-3">
      <h1 className="text-display">Lab</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        TwinLLM runs on this machine, so what it claims about itself can be checked here
        and repeated by hand. For research use only; nothing on this page is about
        anyone&rsquo;s health.
      </p>
    </header>
    {sections.map((section) => (
      <section
        key={section.id}
        aria-labelledby={`lab-section-${section.id}`}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <h2 id={`lab-section-${section.id}`} className="text-xl font-medium">
            {section.title}
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
            {section.intro}
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {section.checks.map((check) => (
            <CheckCard key={check.id} check={check} />
          ))}
        </div>
      </section>
    ))}
  </div>
);
