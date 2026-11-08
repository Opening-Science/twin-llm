"use client";

import { useState } from "react";

import {
  ComparisonPair,
  Consistency,
  InsightCard,
  MonthComparison,
  Radar,
  RangeBars,
  ScoreRing,
  WeeklyBars,
  type ChartRange,
} from "@/infrastructure/charts/kit";

import type { KitCard, KitSection } from "./kit-cards";

/**
 * Draws the dashboard's Daily, Weekly and Monthly sections with the chart
 * kit. Every number, sentence and readout arrives ready from `kitSections`;
 * this file only picks the chart for each card. The radar card is the one
 * with state: its Day / Week / Month switch.
 */

const RANGES: readonly ChartRange[] = ["day", "week", "month"];

const RadarCard = ({ card }: { readonly card: Extract<KitCard, { chart: "radar" }> }) => {
  const options = RANGES.filter((range) => card.views[range] !== null);
  const [range, setRange] = useState<ChartRange>(options[0] ?? "day");
  const view = card.views[range] ?? card.views[options[0] ?? "day"];
  if (!view) return null;
  return (
    <InsightCard
      category={card.category}
      label={card.label}
      sentence={view.sentence}
      interactive
      ranges={
        options.length > 1 ? { value: range, onChange: setRange, options } : undefined
      }
    >
      <Radar category={card.category} axes={view.axes} label={card.label} />
    </InsightCard>
  );
};

const Chart = ({ card }: { readonly card: KitCard }) => {
  const common = { category: card.category, state: card.state, label: card.label };
  switch (card.chart) {
    case "ring":
      return (
        <ScoreRing
          {...common}
          title={card.title}
          band={card.band}
          parts={[{ label: "Score", value: card.value, max: 100, readout: card.readout }]}
        />
      );
    case "pair":
      return (
        <ComparisonPair
          category={card.category}
          state={card.state}
          today={card.today}
          reference={card.reference}
        />
      );
    case "consistency":
      return (
        <Consistency
          {...common}
          values={card.values}
          readouts={card.readouts}
          target={card.target}
          reference={card.reference}
          last={card.last}
          axis={card.axis}
        />
      );
    case "weekly":
      return (
        <WeeklyBars
          {...common}
          values={card.values}
          readouts={card.readouts}
          average={card.average}
          caption={card.caption}
          hero={card.hero}
          unit={card.unit}
        />
      );
    case "month":
      return (
        <MonthComparison
          category={card.category}
          state={card.state}
          current={card.current}
          previous={card.previous}
        />
      );
    case "range":
      return <RangeBars {...common} buckets={card.buckets} axis={card.axis} />;
    case "radar":
      return null;
  }
};

/** Charts with readouts carry their own accessible layer; a pair or a month is a picture. */
const INTERACTIVE: ReadonlySet<KitCard["chart"]> = new Set([
  "ring",
  "consistency",
  "weekly",
  "range",
]);

const Card = ({ card }: { readonly card: KitCard }) =>
  card.chart === "radar" ? (
    <RadarCard card={card} />
  ) : (
    <InsightCard
      category={card.category}
      state={card.state}
      label={card.label}
      sentence={card.sentence}
      interactive={card.state === "default" && INTERACTIVE.has(card.chart)}
    >
      <Chart card={card} />
    </InsightCard>
  );

export const KitDashboard = ({
  sections,
}: {
  readonly sections: readonly KitSection[];
}) => (
  <div className="flex flex-col gap-10">
    {sections.map((section) => (
      <section key={section.id} aria-labelledby={`wearables-${section.id}`}>
        <p className="text-eyebrow">{section.eyebrow}</p>
        <h3
          id={`wearables-${section.id}`}
          className="font-display mt-2 text-2xl leading-tight tracking-tight"
        >
          {section.title}
        </h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {section.cards.map((card) => (
            <div
              key={card.id}
              className={card.chart === "radar" ? "md:col-span-2" : undefined}
            >
              <Card card={card} />
            </div>
          ))}
        </div>
      </section>
    ))}
  </div>
);
