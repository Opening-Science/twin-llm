import { type KioskDay } from "@/packages/query-tools/kiosk-day";

import {
  kioskBeatCount,
  KIOSK_MOCK_NOTE,
  KIOSK_UTC,
  KIOSK_WORTH_A_LOOK_NOTE,
  kioskPlaceholder,
  kioskShows,
} from "./kiosk-copy";
import { type KioskBeat } from "./kiosk-focus";
import { KioskDayStrip } from "./kiosk-strip-view";

/** A ring with a dot, beside words: a window's beat never rests on colour. */
const WorthMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="kiosk-worth-mark">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="12" cy="12" r="3.5" fill="currentColor" />
  </svg>
);

/**
 * One beat of the day on the kiosk, drawn as the kiosk-day contract wrote it:
 * the time and what the person was doing, the value line and the body
 * sentence exactly as given, and where the twin turns, with the day strip
 * showing where the beat falls between midnights. A window's beat reads
 * "Worth a look" as its event, with a mark and a note under it. The day's
 * notice, the placeholder note and UTC are always shown with it
 * (`docs/kiosk-day.md`, rules for the screen).
 */
export const KioskBeatCard = ({
  day,
  index,
  focusLabel,
}: Readonly<{ day: KioskDay; index: number; focusLabel: string }>) => {
  const beat: KioskBeat | undefined = day.beats[index];
  if (!beat) return null;
  return (
    <section className="kiosk-beat" aria-live="polite" aria-atomic="true">
      <p className="kiosk-beat-count">{kioskBeatCount(index, day.beats.length)}</p>
      <KioskDayStrip day={day} current={index} />
      <h2 className="kiosk-beat-head">
        <span className="kiosk-beat-time">{beat.time}</span>
        <span>{beat.event}</span>
      </h2>
      {beat.worth_a_look ? (
        <p className="kiosk-worth">
          <WorthMark />
          <span>{KIOSK_WORTH_A_LOOK_NOTE}</span>
        </p>
      ) : null}
      <p className="kiosk-beat-line">{beat.line}</p>
      <p className="kiosk-beat-body">{beat.body.text}</p>
      <p className="kiosk-beat-shows">{kioskShows(focusLabel)}</p>
      <div className="kiosk-day-notes">
        <p>{day.notice}</p>
        <p>
          {KIOSK_MOCK_NOTE} {kioskPlaceholder(day.thresholds.reviewer)} {KIOSK_UTC}
        </p>
      </div>
    </section>
  );
};
