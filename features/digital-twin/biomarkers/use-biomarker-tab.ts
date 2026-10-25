"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { type FormattableMetric } from "@/infrastructure/format-measure";
import { ATLASES } from "@/packages/anatomy/manifest";

import { type AnatomyAction, type AnatomyState } from "../anatomy/anatomy-state";
import {
  COHORT_FAILED,
  DEMO_LABS_NOTE,
  highlightFromLabel,
  NO_COHORT,
  OTHER_NO_LABS,
  SELF_NO_LABS,
} from "./biomarker-copy";
import {
  latestVitals,
  markerRows,
  vitalRows,
  type BiomarkerRow,
  type LabValue,
} from "./biomarker-rows";
import { loadCohortPeople, loadCohortValues, loadVitalMetrics } from "./cohort-client";
import { type CohortPerson } from "./cohort-handler";
import { rowHighlight, rowNotes } from "./row-highlight";
import {
  cohortLiveVitals,
  NO_LIVE_VITALS,
  wearableLiveVitals,
  type LiveVitals,
} from "../live/live-rates";

/** Whose biomarkers: the Demo borrows synthetic labs, Self shows its own wearable vitals. */
export type BiomarkerSubject = "demo" | "self" | "other";

/** Whether the values are in yet: a read still running or failed is not "no values". */
export type BiomarkerStatus = "loading" | "ok" | "failed";

export type BiomarkerTabModel = Readonly<{
  rows: readonly BiomarkerRow[];
  selectedId: string | null;
  /** Lines under the selected row. */
  notes: readonly string[];
  onSelect: (id: string | null) => void;
  intro: string;
  /** Demo only: the synthetic people the lab values can come from. */
  people: readonly CohortPerson[];
  /** Rates and the HRV state for the live twin (G4); none for other subjects. */
  live: LiveVitals;
  status: BiomarkerStatus;
  personRef: string;
  onPerson: (ref: string) => void;
}>;

/** A failed cohort read says so; it never reads as a person with no labs. */
export const introFor = (
  subject: BiomarkerSubject,
  people: number,
  failed: boolean,
): string => {
  if (subject === "self") return SELF_NO_LABS;
  if (subject === "other") return OTHER_NO_LABS;
  if (failed) return COHORT_FAILED;
  return people > 0 ? DEMO_LABS_NOTE : NO_COHORT;
};

/**
 * `people` and `metrics` are undefined until their first read answers. The
 * Demo waits for the people list and then the chosen person's values; Self
 * waits for its metrics, whose read never fails (it falls back to none).
 */
export const biomarkerStatus = ({
  subject,
  enabled,
  peopleLoaded,
  failed,
  valuesLoaded,
  metricsLoaded,
}: Readonly<{
  subject: BiomarkerSubject;
  enabled: boolean;
  peopleLoaded: boolean;
  failed: boolean;
  valuesLoaded: boolean;
  metricsLoaded: boolean;
}>): BiomarkerStatus => {
  if (!enabled || subject === "other") return "ok";
  if (subject === "self") return metricsLoaded ? "ok" : "loading";
  if (failed) return "failed";
  return peopleLoaded && valuesLoaded ? "ok" : "loading";
};

type Labs = Readonly<{
  ref: string;
  values: readonly LabValue[] | null;
  vitals: readonly LabValue[] | null;
}>;

export const useBiomarkerTab = ({
  subject,
  enabled,
  anatomy,
  dispatch,
}: Readonly<{
  subject: BiomarkerSubject;
  /** False in previews: nothing is fetched. */
  enabled: boolean;
  anatomy: AnatomyState;
  dispatch: (action: AnatomyAction) => void;
}>): BiomarkerTabModel => {
  // null: the read failed.
  const [people, setPeople] = useState<readonly CohortPerson[] | null | undefined>(
    undefined,
  );
  const [chosenRef, setChosenRef] = useState<string | null>(null);
  const [labs, setLabs] = useState<Labs>({ ref: "", values: [], vitals: [] });
  const [metricsRead, setMetrics] = useState<readonly FormattableMetric[] | undefined>(
    undefined,
  );
  const metrics = useMemo(() => metricsRead ?? [], [metricsRead]);
  const personRef = chosenRef ?? people?.[0]?.ref ?? "";

  useEffect(() => {
    if (!enabled || subject !== "demo") return;
    let cancelled = false;
    void loadCohortPeople().then((list) => {
      if (!cancelled) setPeople(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, subject]);

  useEffect(() => {
    if (!enabled || subject !== "demo" || personRef === "") return;
    let cancelled = false;
    void loadCohortValues(personRef).then((reading) => {
      if (!cancelled) {
        setLabs({
          ref: personRef,
          values: reading?.values ?? null,
          vitals: reading?.vitals ?? null,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, subject, personRef]);

  useEffect(() => {
    if (!enabled || subject !== "self") return;
    let cancelled = false;
    void loadVitalMetrics().then((list) => {
      if (!cancelled) setMetrics(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, subject]);

  // Values of a person who is no longer chosen are never shown, even for a moment.
  const current = subject === "demo" && labs.ref === personRef ? labs : null;
  const values = current?.values ?? null;
  const failed = people === null || (current !== null && current.values === null);
  const vitals = subject === "self" ? metrics : null;
  const rows = useMemo(
    () => [...markerRows(values), ...vitalRows(latestVitals(vitals ?? []))],
    [values, vitals],
  );

  // The Demo borrows the chosen synthetic person's rates; Self uses its own summaries.
  const personLabel = people?.find((person) => person.ref === personRef)?.label ?? "";
  const cohortVitals = current?.vitals ?? null;
  const live = useMemo(
    () =>
      subject === "demo"
        ? cohortLiveVitals(cohortVitals, personLabel)
        : subject === "self"
          ? wearableLiveVitals(metrics)
          : NO_LIVE_VITALS,
    [subject, cohortVitals, personLabel, metrics],
  );

  const scheme = ATLASES[anatomy.atlasId].scheme;
  const selected = rows.find((row) => row.id === anatomy.highlightFrom?.id) ?? null;
  const ready = anatomy.load.kind === "ready" ? anatomy.load : null;
  const notes = selected
    ? rowNotes(rowHighlight(selected, scheme), { requested: anatomy.requested, ready })
    : [];

  const onSelect = useCallback(
    (id: string | null) => {
      const row = rows.find((item) => item.id === id);
      if (!row) {
        dispatch({ type: "highlight", highlight: null });
        return;
      }
      // Both atlas kinds, so an atlas switch can light the same row again.
      const highlights = {
        hra: rowHighlight(row, "hra").highlight,
        bodyparts3d: rowHighlight(row, "bodyparts3d").highlight,
      };
      const label = highlightFromLabel(row.source.kind, row.label);
      dispatch({
        type: "highlight",
        highlight: highlights[scheme],
        from: { id: row.id, label, highlights },
      });
    },
    [rows, scheme, dispatch],
  );

  return {
    rows,
    selectedId: selected?.id ?? null,
    notes,
    onSelect,
    intro: introFor(subject, people?.length ?? 0, subject === "demo" && failed),
    status: biomarkerStatus({
      subject,
      enabled,
      peopleLoaded: people !== undefined,
      failed,
      // No people means nothing to wait for; otherwise the chosen person's read.
      valuesLoaded: personRef === "" || current !== null,
      metricsLoaded: metricsRead !== undefined,
    }),
    people: subject === "demo" ? (people ?? []) : [],
    personRef,
    onPerson: setChosenRef,
    live,
  };
};
