import type { TwinBodySpec } from "@/infrastructure/chat-view";
import { focusDepth, focusHighlights } from "@/packages/anatomy/twin-focus";

/**
 * The words of a `twin.body` view, and what its viewer starts on. Positions
 * are words; there are no warning colours and no values. Pure, so the figure's
 * text is tested with exact strings.
 */

const POSITION_WORDS: Readonly<
  Record<TwinBodySpec["organs"][number]["position"], string>
> = {
  below: "Below the published range",
  within: "Within the published range",
  above: "Above the published range",
};

export const TWIN_BODY_SHOW = "Show on the twin";
export const TWIN_BODY_HIDE = "Hide the twin";
export const TWIN_BODY_NOTE =
  "A reference body with donor anatomy, not this person's. Click an organ to make it the context of your next question.";

/** `Liver · Gamma-GT (GGT) · Above the published range`, one per mapped organ. */
export const twinBodyLines = (spec: TwinBodySpec): readonly string[] =>
  spec.organs.map(
    (organ) => `${organ.label} · ${organ.marker} · ${POSITION_WORDS[organ.position]}`,
  );

/** Why no organ has a position, or null when one has. */
export const twinBodyEmptyText = (spec: TwinBodySpec): string | null => {
  if (spec.organs.length > 0) return null;
  if (spec.subject === null)
    return "No lab values were read, so no organ has a position.";
  if (spec.n === 0) {
    return spec.window === null
      ? "No mapped lab marker has a reading in this subject's record."
      : "No mapped lab marker has a reading in this window.";
  }
  return "No reading here has a published range that fits, so no organ has a position.";
};

/** `Demo body · labs of <subject>`; Self is shown with its scan where there is one. */
export const twinBodyCaption = (spec: TwinBodySpec): string => {
  const body = spec.body === "self" ? "Self (scan where available)" : "Demo body";
  return spec.subject === null ? body : `${body} · labs of ${spec.subject}`;
};

/** What the viewer lights and how deep it starts. */
export const twinBodyFocus = (spec: TwinBodySpec) => ({
  id: spec.focus,
  label: spec.label,
  highlights: focusHighlights(spec.focus),
  depth: focusDepth(spec.focus),
});
