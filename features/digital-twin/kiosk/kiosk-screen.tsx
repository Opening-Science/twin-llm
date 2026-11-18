"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
} from "react";

import { type KioskDay } from "@/packages/query-tools/kiosk-day";

import { subscribeNever, useWebglAvailable } from "../scan-scene";
import { KioskBeatCard } from "./kiosk-beat";
import {
  KIOSK_ATTRACT,
  KIOSK_ATTRACT_NOTE,
  KIOSK_FOOTER,
  KIOSK_NEEDS_WEBGL,
  KIOSK_NEXT,
  KIOSK_START,
  KIOSK_SUBTITLE,
  KIOSK_TITLE,
  kioskHintText,
  kioskShows,
} from "./kiosk-copy";
import { kioskFocus } from "./kiosk-focus";
import { kioskHint } from "./kiosk-hint";
import { ATTRACT, type KioskEvent, kioskSession } from "./kiosk-session";
import { kioskTourStops, TOUR_STEP_MS, tourBeat } from "./kiosk-tour";
import { keyboardTrigger, type KioskTrigger } from "./kiosk-trigger";

const KioskTwin = dynamic(() => import("./kiosk-twin").then((mod) => mod.KioskTwin), {
  ssr: false,
});

/** How often the idle clock is read while a day plays. */
const TICK_MS = 1000;

const DEFAULT_TRIGGERS: readonly KioskTrigger[] = [keyboardTrigger];

/**
 * The kiosk: one portrait screen, the twin standing full length in the
 * middle, the title above and the research line below. Built for an 85-inch
 * portrait panel (1080 × 1920 and up); on a landscape screen the same column
 * stands in the centre.
 *
 * Nobody there: the attract loop. The twin turns, lights the places the day
 * will visit one after another (`kiosk-tour.ts`), and the screen asks for a
 * press. A press (anywhere on the screen, or from a trigger such as the
 * keyboard) starts one day in the kiosk-day shape (`docs/kiosk-day.md`),
 * built on the server; each press goes on a beat and the twin turns to the
 * beat's organ. The last beat, or a minute with no press, goes back to the
 * attract loop with nothing of the visit kept (`kiosk-session.ts`). The
 * screen draws what the day says and computes nothing.
 *
 * The kiosk is always dark, whatever the machine's setting: the pale body
 * reads against a dark room, and nobody at a kiosk picks a theme.
 */
export const KioskScreen = ({
  day,
  triggers = DEFAULT_TRIGGERS,
}: Readonly<{ day: KioskDay; triggers?: readonly KioskTrigger[] }>) => {
  const webgl = useWebglAvailable();
  // The probe answers only after hydration; until then neither the twin nor the note shows.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const count = day.beats.length;
  const [session, dispatch] = useReducer(
    (state: typeof ATTRACT, event: KioskEvent) => kioskSession(state, event, count),
    ATTRACT,
  );
  const press = useCallback(() => dispatch({ type: "press", nowMs: Date.now() }), []);
  const back = useCallback(() => dispatch({ type: "back", nowMs: Date.now() }), []);
  const playing = session.phase === "day";
  const index = playing ? session.beat : null;
  const stops = useMemo(() => kioskTourStops(day), [day]);
  const [tourStep, setTourStep] = useState(0);
  const shown = playing ? index : tourBeat(stops, tourStep);
  const beat = shown === null ? undefined : day.beats[shown];
  // One focus object per beat, so the twin turns only when the beat changes.
  const focus = useMemo(() => (beat ? kioskFocus(beat) : null), [beat]);

  useEffect(() => {
    const stops = triggers.map((trigger) => trigger(press, back));
    return () => stops.forEach((stop) => stop());
  }, [triggers, press, back]);

  // Only a playing day has a clock to watch; the attract loop needs none.
  // The same tick keeps the hint's countdown current.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      dispatch({ type: "tick", nowMs: now });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing]);
  const hint = kioskHint(session, count, nowMs);

  // Back in the attract loop, focus leaves whatever the last visitor reached,
  // and the tour starts again from its first place.
  useEffect(() => {
    if (playing) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setTourStep(0);
    const timer = window.setInterval(() => setTourStep((step) => step + 1), TOUR_STEP_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  return (
    <div className="kiosk dark" data-phase={session.phase}>
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
          <>
            {hint ? (
              <p className="kiosk-hint" data-kind={hint.kind}>
                {kioskHintText(hint)}
              </p>
            ) : null}
            <KioskBeatCard day={day} index={index} focusLabel={focus.label} />
          </>
        ) : (
          <div className="kiosk-attract">
            <p className="kiosk-attract-call">{KIOSK_ATTRACT}</p>
            <p className="kiosk-attract-note">{KIOSK_ATTRACT_NOTE}</p>
            {focus ? (
              <p className="kiosk-attract-shows">{kioskShows(focus.label)}</p>
            ) : null}
          </div>
        )}
      </div>
      <footer className="kiosk-foot">
        <p>{KIOSK_FOOTER}</p>
      </footer>
      {/* The whole screen is the one control: a press starts the day or goes on. */}
      <button
        type="button"
        className="kiosk-press"
        aria-label={playing ? KIOSK_NEXT : KIOSK_START}
        onClick={press}
      />
    </div>
  );
};
