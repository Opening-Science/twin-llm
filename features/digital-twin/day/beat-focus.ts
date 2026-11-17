import { DEPTH_STOPS } from "@/packages/anatomy/layers";
import { type AtlasScheme } from "@/packages/anatomy/manifest";
import { type Highlight } from "@/packages/anatomy/highlight";
import { focusHighlights, twinFocus } from "@/packages/anatomy/twin-focus";
import { type KioskDay } from "@/packages/query-tools/kiosk-day";

/**
 * Where the twin turns for a beat: the beat's `view` as the server wrote it,
 * turned into the viewer's highlight and depth. Pure, so the mapping is
 * tested apart from the 3D view.
 */

export type KioskBeat = KioskDay["beats"][number];

/** Highlight ids from a beat start with this, so clearing one never clears a pick. */
export const BEAT_FOCUS_PREFIX = "day:";

export type BeatFocus = Readonly<{
  id: string;
  label: string;
  highlights: Readonly<Record<AtlasScheme, Highlight>>;
  /** The slider depth of the beat's layer (`layers.ts` stops). */
  depth: number;
}>;

export const beatFocus = (beat: KioskBeat): BeatFocus => {
  const stop = DEPTH_STOPS.find((one) => one.layer === beat.view.depth);
  return {
    id: `${BEAT_FOCUS_PREFIX}${beat.time}:${beat.view.focus}`,
    label: twinFocus(beat.view.focus).label,
    highlights: focusHighlights(beat.view.focus),
    depth: stop?.depth ?? 0,
  };
};
