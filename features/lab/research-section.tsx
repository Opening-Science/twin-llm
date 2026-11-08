import { type Category, InsightCard, ResearchFigure } from "@/infrastructure/charts/kit";

import {
  type ResearchCard,
  type ResearchRead,
  type ResearchStudy,
  STUDY_ORDER,
  STUDY_TITLE,
} from "./research-results";

/**
 * The committed research results as kit figures, one card per figure, under
 * a heading per study. Each card says in one sentence what it shows, names
 * the file its numbers come from and, when the summary records one, the day
 * of the run. The figures are interactive: hover, a finger or the arrow keys
 * name the focused row in the readout line.
 */

/**
 * The kit colours a card by category; the studies are not categories, so
 * each takes one of the four series in study order (the heading carries the
 * word, the colour only tells the studies apart).
 */
const STUDY_CATEGORY: Readonly<Record<ResearchStudy, Category>> = {
  grounding: "vitals",
  arrhythmia: "activity",
  "heart-brain": "heart",
  disclosure: "sleep",
};

const FigureCard = ({ card }: Readonly<{ card: ResearchCard }>) => {
  const category = STUDY_CATEGORY[card.study];
  return (
    <InsightCard
      category={category}
      label={card.label}
      sentence={card.sentence}
      interactive
    >
      <div className="flex flex-col gap-4">
        {card.figure.kind === "pairs" ? (
          <ResearchFigure
            kind="pairs"
            category={category}
            label={card.label}
            groups={card.figure.groups}
          />
        ) : (
          <ResearchFigure
            kind="estimates"
            category={category}
            label={card.label}
            estimates={card.figure.estimates}
            reference={card.figure.reference}
            domain={card.figure.domain}
          />
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
  <div className="flex flex-col gap-8">
    {STUDY_ORDER.map((study) => {
      const cards = data.cards.filter((card) => card.study === study);
      if (cards.length === 0) return null;
      return (
        <section
          key={study}
          className="flex flex-col gap-3"
          aria-labelledby={`study-${study}`}
        >
          <h2 id={`study-${study}`} className="text-base font-medium">
            {STUDY_TITLE[study]}
          </h2>
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
