"use client";

import { useEffect, useMemo, useState } from "react";

import { loadVitalMetrics } from "../biomarkers/cohort-client";
import { type DayPlan, dayPlan, type MotionDay } from "./day-motion";
import { dayLines } from "./motion-copy";
import { wearableMotionDays } from "./motion-days";

/**
 * Which wearable day the twin follows (#52): off until asked, then the days
 * are read once per subject (the Demo person's synthetic series, or Self's own
 * linked wearables), the newest is chosen, and Night lies the body down. The
 * plan and its lines exist only while following.
 */

export type DaySubject = "demo" | "self" | "other";

/** The chosen day when it is still listed, else the newest; null without days. */
export const pickDay = (
  days: readonly MotionDay[],
  chosen: string | null,
): MotionDay | null => days.find((day) => day.day === chosen) ?? days[0] ?? null;

/** The parsed days of a `/api/motion/days` body, or null when it is not one. */
export const parseMotionDays = (body: unknown): readonly MotionDay[] | null => {
  const days =
    body && typeof body === "object" ? (body as { days?: unknown }).days : undefined;
  return Array.isArray(days) ? (days as MotionDay[]) : null;
};

/** Whose data the lines name. */
export const daySource = (subject: DaySubject, personLabel: string): string =>
  subject === "demo"
    ? `${personLabel || "Synthetic person"}, synthetic series`
    : "linked wearables";

export type DayMotionState = Readonly<{
  subject: DaySubject;
  following: boolean;
  night: boolean;
  /** Undefined while loading, null when the read failed. */
  days: readonly MotionDay[] | null | undefined;
  selected: MotionDay | null;
  /** What the twin does, only while following a listed day. */
  plan: DayPlan | null;
  lines: readonly string[] | null;
  onFollow: (following: boolean) => void;
  onDay: (day: string) => void;
  onNight: (night: boolean) => void;
}>;

type Loaded = Readonly<{ key: string; days: readonly MotionDay[] | null }>;

const loadDays = async (
  subject: DaySubject,
  personRef: string,
): Promise<readonly MotionDay[] | null> => {
  if (subject === "self") return wearableMotionDays(await loadVitalMetrics());
  const response = await fetch(`/api/motion/days/${encodeURIComponent(personRef)}`);
  return response.ok ? parseMotionDays(await response.json()) : null;
};

export const useDayMotion = ({
  subject,
  personRef,
  personLabel,
  enabled,
}: Readonly<{
  subject: DaySubject;
  /** The Demo's synthetic person. */
  personRef: string;
  personLabel: string;
  /** False in previews: nothing is fetched. */
  enabled: boolean;
}>): DayMotionState => {
  const [following, setFollowing] = useState(false);
  const [night, setNight] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${subject}:${subject === "demo" ? personRef : ""}`;
  const readable = subject === "self" || (subject === "demo" && personRef !== "");

  useEffect(() => {
    if (!enabled || !following || !readable) return;
    let cancelled = false;
    void loadDays(subject, personRef)
      .catch((error: unknown) => {
        console.error("[motion] wearable days could not be loaded", error);
        return null;
      })
      .then((days) => {
        if (!cancelled) setLoaded({ key, days });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, following, readable, subject, personRef, key]);

  // Days of a subject or person no longer shown are never used, even for a moment.
  const days = !readable ? [] : loaded?.key === key ? loaded.days : undefined;
  const selected = days ? pickDay(days, chosen) : null;
  const source = daySource(subject, personLabel);
  const plan = useMemo(
    () => (following && selected ? dayPlan(selected, night, subject === "demo") : null),
    [following, selected, night, subject],
  );
  const lines = useMemo(
    () => (plan && selected ? dayLines(plan, selected, source) : null),
    [plan, selected, source],
  );
  return {
    subject,
    following,
    night,
    days,
    selected,
    plan,
    lines,
    onFollow: setFollowing,
    onDay: setChosen,
    onNight: setNight,
  };
};
