"use client";

import { useEffect, useMemo, useState } from "react";

import { type GlucoseProfile } from "@/packages/query-tools/day-beats";
import { type KioskDay } from "@/packages/query-tools/kiosk-day";

import { type BeatFocus, beatFocus } from "./beat-focus";
import { DAY_FAILED } from "./day-copy";
import {
  type DayListEntry,
  dayUrl,
  MOCK_CHOICE,
  parseDay,
  parseDayList,
  parseError,
  parsePeriod,
  periodUrl,
  type PeriodView,
  pickChoice,
} from "./day-view";

/**
 * "Show me my day" for the Demo person: their days are read once per person,
 * the newest is shown (or the illustrative mock day when they have none),
 * and each choice of day or glucose profile reads that one day. Results are
 * kept per URL, so a stale answer never shows under a newer choice.
 */

export type MyDayState = Readonly<{
  /** Undefined while loading, null when the read failed. */
  days: readonly DayListEntry[] | null | undefined;
  /** A listed day, or `MOCK_CHOICE`. */
  choice: string;
  profile: GlucoseProfile;
  /** Undefined while loading. */
  day: KioskDay | undefined;
  /** A sentence from the route, or the panel's own; null with a day. */
  error: string | null;
  /** The beat the twin shows, by index in `day.beats`; null when none is picked. */
  selected: number | null;
  /** Where the twin turns for the selected beat. */
  focus: BeatFocus | null;
  onChoice: (choice: string) => void;
  onProfile: (profile: GlucoseProfile) => void;
  /** Picks a beat, or with null lets the twin go. */
  onBeat: (index: number | null) => void;
  /** The week or month ending on the chosen day; none for the mock. */
  period: PeriodState;
}>;

export type PeriodState = Readonly<{
  period: "week" | "month";
  /** False for the mock day, which is a single day. */
  available: boolean;
  /** Undefined while loading. */
  summary: PeriodView | undefined;
  error: string | null;
  onPeriod: (period: "week" | "month") => void;
}>;

type Loaded<T> = Readonly<{ key: string; value: T }>;
type DayOutcome = Readonly<{ day: KioskDay | null; error: string | null }>;
type PeriodOutcome = Readonly<{ summary: PeriodView | null; error: string | null }>;

const readJson = async (url: string): Promise<{ ok: boolean; body: unknown }> => {
  const response = await fetch(url);
  return { ok: response.ok, body: await response.json().catch(() => null) };
};

const loadDay = async (url: string): Promise<DayOutcome> => {
  const { ok, body } = await readJson(url);
  const day = ok ? parseDay(body) : null;
  return day
    ? { day, error: null }
    : { day: null, error: parseError(body) ?? DAY_FAILED };
};

const loadPeriod = async (url: string): Promise<PeriodOutcome> => {
  const { ok, body } = await readJson(url);
  const summary = ok ? parsePeriod(body) : null;
  return summary
    ? { summary, error: null }
    : { summary: null, error: parseError(body) ?? DAY_FAILED };
};

export const useMyDay = ({
  personRef,
  enabled,
}: Readonly<{
  /** The Demo's synthetic person; empty until the list is known. */
  personRef: string;
  /** False in previews and away from the Demo: nothing is fetched. */
  enabled: boolean;
}>): MyDayState => {
  const [chosen, setChosen] = useState<string | null>(null);
  const [profile, setProfile] = useState<GlucoseProfile>("without_diabetes");
  const [days, setDays] = useState<Loaded<readonly DayListEntry[] | null> | null>(null);
  const [outcome, setOutcome] = useState<Loaded<DayOutcome> | null>(null);
  const [picked, setPicked] = useState<Loaded<number> | null>(null);
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [periodOutcome, setPeriodOutcome] = useState<Loaded<PeriodOutcome> | null>(null);

  const listed = days?.key === personRef ? days.value : undefined;
  const choice = pickChoice(listed, chosen);
  // Nothing is read until the person's list is in, so the mock never flashes first.
  const url = listed === undefined ? null : dayUrl(choice, personRef, profile);

  useEffect(() => {
    if (!enabled || personRef === "") return;
    let cancelled = false;
    void readJson(`/api/digital-twin/days/${encodeURIComponent(personRef)}`)
      .then(({ ok, body }) => (ok ? parseDayList(body) : null))
      .catch(() => null)
      .then((value) => {
        if (!cancelled) setDays({ key: personRef, value });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, personRef]);

  useEffect(() => {
    if (!enabled || url === null) return;
    let cancelled = false;
    void loadDay(url)
      .catch((): DayOutcome => ({ day: null, error: DAY_FAILED }))
      .then((value) => {
        if (!cancelled) setOutcome({ key: url, value });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

  const summaryUrl =
    listed === undefined ? null : periodUrl(choice, personRef, period, profile);
  useEffect(() => {
    if (!enabled || summaryUrl === null) return;
    let cancelled = false;
    void loadPeriod(summaryUrl)
      .catch((): PeriodOutcome => ({ summary: null, error: DAY_FAILED }))
      .then((value) => {
        if (!cancelled) setPeriodOutcome({ key: summaryUrl, value });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, summaryUrl]);
  const periodNow =
    periodOutcome && periodOutcome.key === summaryUrl ? periodOutcome.value : undefined;

  const current = outcome && outcome.key === url ? outcome.value : undefined;
  const day = current?.day ?? undefined;
  // A pick belongs to one day: another day, profile or person starts with none.
  const selected =
    picked && picked.key === url && day && picked.value < day.beats.length
      ? picked.value
      : null;
  const beat = selected === null ? undefined : day?.beats[selected];
  // Stable while the same beat stays picked, so the twin turns once per pick.
  const focus = useMemo(() => (beat ? beatFocus(beat) : null), [beat]);
  return {
    days: listed,
    choice,
    profile,
    day,
    error: current?.error ?? null,
    selected,
    focus,
    onChoice: setChosen,
    onProfile: setProfile,
    period: {
      period,
      available: choice !== MOCK_CHOICE,
      summary: periodNow?.summary ?? undefined,
      error: periodNow?.error ?? null,
      onPeriod: setPeriod,
    },
    onBeat: (index) =>
      setPicked(index === null || url === null ? null : { key: url, value: index }),
  };
};
