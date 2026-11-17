"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { type KioskDay } from "@/packages/query-tools/kiosk-day";

import { subscribeNever, useWebglAvailable } from "../scan-scene";
import { KioskBeatCard } from "./kiosk-beat";
import {
  KIOSK_FOOTER,
  KIOSK_NEEDS_WEBGL,
  KIOSK_NEXT,
  KIOSK_SUBTITLE,
  KIOSK_TITLE,
} from "./kiosk-copy";
import { kioskFocus } from "./kiosk-focus";
import { kioskKeyStep, stepKioskBeat } from "./kiosk-play";

const KioskTwin = dynamic(() => import("./kiosk-twin").then((mod) => mod.KioskTwin), {
  ssr: false,
});

/**
 * The kiosk: one portrait screen, the twin standing full length in the
 * middle, the title above, the day's beat and the research line below.
 * Built for an 85-inch portrait panel (1080 × 1920 and up); on a landscape
 * screen the same column stands in the centre.
 *
 * It plays one day in the kiosk-day shape (`docs/kiosk-day.md`), built on
 * the server. A press anywhere, or Space, Enter or an arrow key, goes on to
 * the next beat, and the twin turns to the beat's organ. The screen draws
 * what the day says and computes nothing.
 *
 * The kiosk is always dark, whatever the machine's setting: the pale body
 * reads against a dark room, and nobody at a kiosk picks a theme.
 */
export const KioskScreen = ({ day }: Readonly<{ day: KioskDay }>) => {
  const webgl = useWebglAvailable();
  // The probe answers only after hydration; until then neither the twin nor the note shows.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const count = day.beats.length;
  const [index, setIndex] = useState<number | null>(stepKioskBeat(null, count, "next"));
  const beat = index === null ? undefined : day.beats[index];
  // One focus object per beat, so the twin turns only when the beat changes.
  const focus = useMemo(() => (beat ? kioskFocus(beat) : null), [beat]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const step = kioskKeyStep(event.key);
      if (step === null || event.repeat) return;
      // On the focused press button, Space and Enter already click it.
      if (
        event.target instanceof HTMLButtonElement &&
        (event.key === " " || event.key === "Enter")
      )
        return;
      event.preventDefault();
      setIndex((current) => stepKioskBeat(current, count, step));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  return (
    <div className="kiosk dark">
      <header className="kiosk-head">
        <h1 className="kiosk-title">{KIOSK_TITLE}</h1>
        <p className="kiosk-subtitle">{KIOSK_SUBTITLE}</p>
      </header>
      <div className="kiosk-stage">
        {webgl ? (
          <KioskTwin focus={focus} />
        ) : hydrated ? (
          <p className="kiosk-twin-note">{KIOSK_NEEDS_WEBGL}</p>
        ) : null}
      </div>
      <div className="kiosk-panel">
        {index !== null && focus ? (
          <KioskBeatCard day={day} index={index} focusLabel={focus.label} />
        ) : null}
      </div>
      <footer className="kiosk-foot">
        <p>{KIOSK_FOOTER}</p>
      </footer>
      {/* The whole screen is the one control: a press goes on. */}
      <button
        type="button"
        className="kiosk-press"
        aria-label={KIOSK_NEXT}
        onClick={() => setIndex((current) => stepKioskBeat(current, count, "next"))}
      />
    </div>
  );
};
