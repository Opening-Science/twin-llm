import { type KioskDay } from "@/packages/query-tools/kiosk-day";

import { KIOSK_STRIP_HOURS } from "./kiosk-copy";
import { dayShare, dayStrip } from "./kiosk-strip";

const percent = (share: number): string => `${(share * 100).toFixed(3)}%`;

/**
 * The day from midnight to midnight under a beat: a tick per beat time, the
 * current one tall and solid, worth-a-look times as a hollow ring over a
 * hatched band. Shapes, not colours, tell them apart. It repeats what the
 * beat card already says in words (the time, "Worth a look"), so it is
 * hidden from screen readers.
 */
export const KioskDayStrip = ({
  day,
  current,
}: Readonly<{ day: KioskDay; current: number | null }>) => {
  const { marks, bands } = dayStrip(day, current);
  return (
    <div className="kiosk-strip" aria-hidden="true">
      <div className="kiosk-strip-track">
        {bands.map((band) => (
          <span
            key={band.from}
            className="kiosk-strip-band"
            style={{ left: percent(band.from), width: percent(band.width) }}
          />
        ))}
        {marks.map((mark) => (
          <span
            key={mark.at}
            className="kiosk-strip-mark"
            data-current={mark.current ? "" : undefined}
            data-worth={mark.worth ? "" : undefined}
            style={{ left: percent(mark.at) }}
          />
        ))}
      </div>
      <div className="kiosk-strip-hours">
        {KIOSK_STRIP_HOURS.map((hour) => (
          <span key={hour} style={{ left: percent(dayShare(hour)) }}>
            {hour}
          </span>
        ))}
      </div>
    </div>
  );
};
