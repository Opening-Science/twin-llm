"use client";

import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import {
  PERIOD_LOADING,
  PERIOD_MOCK,
  PERIOD_OPTIONS,
  PERIOD_PICK,
  PERIOD_TITLE,
} from "./day-copy";
import { type PeriodState } from "./use-my-day";

/**
 * The week or month ending on the chosen day: glucose, resting heart rate,
 * HRV and recovery, one line each as the route wrote them. The mock day is a
 * single day, so it gets a sentence instead.
 */

const TITLE_ID = "twin-period-title";

export const PeriodCard = ({ state }: Readonly<{ state: PeriodState }>) => (
  <section className="twin-period" aria-labelledby={TITLE_ID}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 id={TITLE_ID} className="text-sm font-medium">
        {PERIOD_TITLE}
      </h4>
      {state.available ? (
        <SegmentedControl
          label={PERIOD_PICK}
          size="sm"
          options={PERIOD_OPTIONS}
          value={state.period}
          onChange={state.onPeriod}
        />
      ) : null}
    </div>
    {!state.available ? (
      <p className="text-muted-foreground text-xs">{PERIOD_MOCK}</p>
    ) : state.error ? (
      <p className="text-muted-foreground text-sm">{state.error}</p>
    ) : state.summary ? (
      <>
        <p className="text-muted-foreground text-xs">{state.summary.title}</p>
        <dl className="twin-period-lines">
          {state.summary.lines.map((line) => (
            <div key={line.label} className="contents">
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd>{line.text}</dd>
            </div>
          ))}
        </dl>
        {state.summary.notes.map((note) => (
          <p key={note} className="text-muted-foreground text-xs">
            {note}
          </p>
        ))}
      </>
    ) : (
      <p className="text-muted-foreground text-xs">{PERIOD_LOADING}</p>
    )}
  </section>
);
