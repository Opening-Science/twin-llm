import { HubCard, HubGrid } from "@/infrastructure/ui-kit/hub-card";

import { type LabHubCard } from "./lab-hub";

/**
 * `/lab`: the hub. One card per experiment (`lab-hub.ts` decides the words);
 * each opens its own page under `/lab/…`.
 */
export const LabHubScreen = ({ cards }: Readonly<{ cards: readonly LabHubCard[] }>) => (
  <div className="lab-page">
    <header className="flex flex-col gap-2">
      <h1 className="text-display">Lab</h1>
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        Check what runs on this machine, make simulated recordings of synthetic people,
        and read the evaluation results. In-silico research only; nothing here is about
        anyone&rsquo;s health.
      </p>
    </header>
    <HubGrid label="Lab experiments">
      {cards.map((card) => (
        <HubCard
          key={card.part}
          href={card.href}
          title={card.title}
          line={card.line}
          meta={card.meta}
          tone={card.tone}
        />
      ))}
    </HubGrid>
  </div>
);
