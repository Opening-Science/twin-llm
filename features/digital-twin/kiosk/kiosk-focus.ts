import { type Highlight } from "@/packages/anatomy/highlight";
import { DEPTH_STOPS } from "@/packages/anatomy/layers";
import { type AtlasScheme } from "@/packages/anatomy/manifest";
import { focusHighlights, twinFocus } from "@/packages/anatomy/twin-focus";
import { type KioskDay } from "@/packages/query-tools/kiosk-day";

/**
 * Where the kiosk's twin turns for a beat: the beat's `view` as the server
 * wrote it, as the viewer's highlight and slider depth. Pure, so the mapping
 * is tested apart from the 3D view.
 */

export type KioskBeat = KioskDay["beats"][number];

export type KioskFocus = Readonly<{
  label: string;
  highlights: Readonly<Record<AtlasScheme, Highlight>>;
  /** The slider depth of the beat's layer (`layers.ts` stops). */
  depth: number;
}>;

export const kioskFocus = (beat: KioskBeat): KioskFocus => {
  const stop = DEPTH_STOPS.find((one) => one.layer === beat.view.depth);
  return {
    label: twinFocus(beat.view.focus).label,
    highlights: focusHighlights(beat.view.focus),
    depth: stop?.depth ?? 0,
  };
};
