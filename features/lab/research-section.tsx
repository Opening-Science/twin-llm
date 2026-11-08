import { type Category, InsightCard, ResearchFigure } from "@/infrastructure/charts/kit";
import { Card } from "@/infrastructure/ui-kit/card";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import {
  type ResearchCard,
  type ResearchFigureData,
  type ResearchRead,
  type ResearchStudy,
  STUDY_ORDER,
  STUDY_TITLE,
} from "./research-results";
import { STUDY_STATUS } from "./research-summary";

/**
 * The committed research results for readers who did not run the studies:
 * a short guide to reading the figures and the sources, then per study a
 * "What we found" with its status, then one card per figure. A card leads
 * with a plain headline built from its numbers, keeps the technical
 * sentence as a caption, names its axis and its source file, and puts the
 * remaining rows behind "Show all". The figures are interactive: hover, a
 * finger or the arrow keys name the focused row in the readout line.
 */

/**
 * The kit colours a card by category; the studies are not categories, so
 * each takes one of the four series in study order. The heading carries the
 * word; the colour only tells the studies apart.
 */
const STUDY_CATEGORY: Readonly<Record<ResearchStudy, Category>> = {
  grounding: "vitals",
  arrhythmia: "activity",
  "heart-brain": "heart",
  disclosure: "sleep",
};

const SOURCES: readonly (readonly [string, string])[] = [
  [
    "Synthetic cohort (Synthea)",
    "Made-up patient records from the open Synthea generator; no real person is in them.",
  ],
  [
    "Question sets (v1, v1h, s7, s7b, s7h)",
    "Questions about the synthetic cohort with known answers: the main set (v1), held-out questions (v1h), rhythm questions (s7), the same on a second cohort (s7b) and held-out rhythm questions (s7h).",
  ],
  [
    "MIT-BIH AF database (AFDB)",
    "Open annotated ECG recordings from PhysioNet; the paper the AF flag's thresholds come from used it to derive or test them.",
  ],
  [
    "Long-term AF database (LTAFDB)",
    "Open day-long annotated ECG recordings from PhysioNet that played no part in those thresholds.",
  ],
  [
    "Pilot 1 and the positive control",
    "Pilot 1 is a small model fine-tuned on synthetic conversations; the control is one deliberately overfit on a few synthetic people, to show the attacks can work.",
  ],
];

const HowToRead = () => (
  <Card padding="lg" className="rounded-card flex flex-col gap-4">
    <h2 className="text-base font-medium">How to read these</h2>
    <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
      <li>
        <span className="text-foreground">Dot</span>: the estimate.
      </li>
      <li>
        <span className="text-foreground">Line through the dot</span>: its 95 % interval
        (a Wilson 95 % interval for shares of answers, a bootstrap interval for the
        benchmarks). A dot without a line has no interval.
      </li>
      <li>
        <span className="text-foreground">Dotted line</span>: the reference, such as 1 =
        no difference or 0.5 = chance.
      </li>
      <li>Hover a figure, or tab to it and use the arrow keys, to read each row.</li>
    </ul>
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
      {SOURCES.map(([term, line]) => (
        <div key={term} className="contents">
          <dt className="text-foreground">{term}</dt>
          <dd className="text-muted-foreground">{line}</dd>
        </div>
      ))}
    </dl>
  </Card>
);

const Figure = ({
  figure,
  category,
  label,
}: Readonly<{ figure: ResearchFigureData; category: Category; label: string }>) =>
  figure.kind === "pairs" ? (
    <ResearchFigure
      kind="pairs"
      category={category}
      label={label}
      groups={figure.groups}
    />
  ) : (
    <ResearchFigure
      kind="estimates"
      category={category}
      label={label}
      estimates={figure.estimates}
      reference={figure.reference}
      domain={figure.domain}
    />
  );

const AxisTitle = ({ children }: Readonly<{ children: string }>) => (
  <p className="text-muted-foreground text-center font-mono text-xs">{children}</p>
);

const FigureCard = ({ card }: Readonly<{ card: ResearchCard }>) => {
  const category = STUDY_CATEGORY[card.study];
  return (
    <InsightCard
      category={category}
      label={card.label}
      sentence={card.headline}
      interactive
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm leading-relaxed">{card.caption}</p>
        <div className="flex flex-col gap-1">
          <Figure figure={card.figure} category={category} label={card.label} />
          <AxisTitle>{card.axis}</AxisTitle>
        </div>
        {card.more === null ? null : (
          <details className="setup-disclosure">
            <summary>{card.more.label}</summary>
            <div className="mt-3 flex flex-col gap-1">
              <Figure
                figure={card.more.figure}
                category={category}
                label={`${card.label}, all rows`}
              />
              <AxisTitle>{card.axis}</AxisTitle>
            </div>
          </details>
        )}
        <p className="text-muted-foreground font-mono text-xs break-all tabular-nums">
          {card.source}
          {card.runDate === null ? null : <> · run {card.runDate}</>}
        </p>
      </div>
    </InsightCard>
  );
};

export const ResearchSection = ({ data }: Readonly<{ data: ResearchRead }>) => (
  <div className="flex flex-col gap-10">
    <HowToRead />
    {STUDY_ORDER.map((study) => {
      const cards = data.cards.filter((card) => card.study === study);
      if (cards.length === 0) return null;
      const summary = data.summaries[study];
      return (
        <section
          key={study}
          className="flex flex-col gap-4"
          aria-labelledby={`study-${study}`}
        >
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <h2 id={`study-${study}`} className="text-base font-medium">
                {STUDY_TITLE[study]}
              </h2>
              {STUDY_STATUS[study].map((status) => (
                <StatusBadge key={status} tone="neutral">
                  {status}
                </StatusBadge>
              ))}
            </div>
            {summary === undefined ? null : (
              <div className="max-w-prose">
                <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  What we found
                </h3>
                <p className="mt-1 leading-relaxed">{summary.found}</p>
              </div>
            )}
          </header>
          <div className="grid gap-4">
            {cards.map((card) => (
              <FigureCard key={card.id} card={card} />
            ))}
          </div>
        </section>
      );
    })}
    {data.unread.length === 0 ? null : (
      <p className="text-muted-foreground text-sm">
        These files could not be read or have changed shape, so their figures are left
        out:{" "}
        {data.unread.map((path, i) => (
          <span key={path}>
            {i === 0 ? "" : ", "}
            <code className="font-mono text-xs">{path}</code>
          </span>
        ))}
        .
      </p>
    )}
  </div>
);
