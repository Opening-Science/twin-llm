import { type KioskHint } from "./kiosk-hint";

/**
 * Words on the kiosk. The kiosk stands in a public room in front of people
 * who never signed in, so it shows a synthetic body only and says so.
 */

export const KIOSK_TITLE = "TwinLLM";

/** Under the title, always shown: whose body this is. */
export const KIOSK_SUBTITLE = "A digital twin of a synthetic person";

/** The line under the twin, always on screen. */
export const KIOSK_FOOTER =
  "Research software of the Open Science Foundation. The body is synthetic: not a scan of anyone, and not advice.";

/** The 3D view's accessible name. */
export const KIOSK_VIEW_LABEL = "Synthetic body, turning slowly";

/** Without WebGL there is no twin to show. */
export const KIOSK_NEEDS_WEBGL = "This screen needs WebGL to show the twin.";

/** The body file did not load. */
export const KIOSK_BODY_MISSING = "The twin could not be loaded on this screen.";

/** The one control: the whole screen, pressed to go on. */
export const KIOSK_NEXT = "Next moment of the day";

/** Which beat of how many, counted from one. */
export const kioskBeatCount = (index: number, total: number): string =>
  `${index + 1} of ${total}`;

/** Under the beat: what the twin now shows. */
export const kioskShows = (label: string): string => `The twin shows: ${label}.`;

/** Under a window's beat, beside its mark: what "Worth a look" means. */
export const KIOSK_WORTH_A_LOOK_NOTE =
  "A moment to look at, not a verdict on the person.";

/** Always with the day. */
export const KIOSK_MOCK_NOTE = "Illustrative mock: made-up values for a made-up person.";
export const KIOSK_UTC = "Times are UTC.";

/** The thresholds stay placeholders until the reviewer confirms them. */
export const kioskPlaceholder = (reviewer: string): string =>
  `Thresholds are placeholders until ${reviewer} confirms them.`;

/** Under the day strip: midnight, every six hours, midnight. */
export const KIOSK_STRIP_HOURS = ["00:00", "06:00", "12:00", "18:00", "24:00"] as const;

/** The attract loop: nobody is at the screen yet. */
export const KIOSK_ATTRACT = "Press anywhere to start";
export const KIOSK_ATTRACT_NOTE =
  "See one day of a synthetic person: heart rate and blood sugar, beat by beat, on the twin.";

/** The one control's name before a day starts. */
export const KIOSK_START = "Start the day";

/** Above a playing beat: what a press does, or how soon the kiosk goes back. */
export const kioskHintText = (hint: KioskHint): string => {
  switch (hint.kind) {
    case "next":
      return "Press anywhere for the next moment.";
    case "last":
      return "That was the last moment. Press to finish.";
    case "leaving":
      return `Going back to the start in ${hint.seconds} ${
        hint.seconds === 1 ? "second" : "seconds"
      }. Press to stay.`;
  }
};
