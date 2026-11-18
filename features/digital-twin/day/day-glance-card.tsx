"use client";

import { type ReactNode, useEffect, useState } from "react";

import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import { loadCohortPeople } from "../biomarkers/cohort-client";
import { type CohortPerson } from "../biomarkers/cohort-handler";
import { MY_DAY_LOADING, WORTH_A_LOOK } from "./day-copy";
import {
  DAY_GLANCE_FAILED,
  DAY_GLANCE_NO_PEOPLE,
  DAY_GLANCE_SYNTHETIC,
  DAY_GLANCE_TITLE,
  dayGlance,
} from "./day-glance";
import { MOCK_CHOICE } from "./day-view";
import { useMyDay } from "./use-my-day";

/**
 * "Show me my day" on the Dashboard page: the first synthetic person's
 * newest day, read through the same routes and hook as the Digital Twin
 * page, shown as a few lines. The illustrative mock day stands in when the
 * person has no day, and says so.
 */

const Card = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div className="surface flex flex-col gap-3 px-5 py-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-medium">{DAY_GLANCE_TITLE}</h3>
      <StatusBadge tone="neutral">{DAY_GLANCE_SYNTHETIC}</StatusBadge>
    </div>
    {children}
  </div>
);

const Muted = ({ children }: Readonly<{ children: string }>) => (
  <p className="text-muted-foreground text-sm">{children}</p>
);

export const DayGlanceCard = () => {
  const [people, setPeople] = useState<readonly CohortPerson[] | null | undefined>();
  useEffect(() => {
    let cancelled = false;
    void loadCohortPeople().then((list) => {
      if (!cancelled) setPeople(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const person = people?.[0];
  const state = useMyDay({ personRef: person?.ref ?? "", enabled: person !== undefined });

  if (people === undefined) {
    return (
      <Card>
        <Muted>{MY_DAY_LOADING}</Muted>
      </Card>
    );
  }
  if (!person) {
    return (
      <Card>
        <Muted>{people === null ? DAY_GLANCE_FAILED : DAY_GLANCE_NO_PEOPLE}</Muted>
      </Card>
    );
  }
  if (state.error) {
    return (
      <Card>
        <Muted>{state.error}</Muted>
      </Card>
    );
  }
  if (!state.day) {
    return (
      <Card>
        <Muted>{MY_DAY_LOADING}</Muted>
      </Card>
    );
  }
  const glance = dayGlance({
    day: state.day,
    personLabel: person.label,
    mock: state.choice === MOCK_CHOICE,
  });
  return (
    <Card>
      <div>
        <p className="text-eyebrow">{glance.heading}</p>
        <p className="mt-1 text-sm">{glance.summary}</p>
      </div>
      {glance.worth.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{WORTH_A_LOOK}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {glance.worth.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {glance.more ? <Muted>{glance.more}</Muted> : null}
        </div>
      ) : null}
      <div className="text-muted-foreground flex flex-col gap-1 text-xs">
        {glance.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </Card>
  );
};
