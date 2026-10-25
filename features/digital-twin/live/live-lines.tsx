import { isoLocalDate } from "@/infrastructure/format-measure";
import { type AtlasScheme } from "@/packages/anatomy/manifest";

import { type LiveStatus } from "./live-conditioning";
import {
  BODYPARTS3D_BREATH_NOTE,
  BODYPARTS3D_HEART_NOTE,
  breathingLine,
  hrvLine,
  ILLUSTRATIVE,
  NO_RATE,
  pulseLine,
  SHOW_ORGANS,
} from "./live-copy";
import { type LiveVitals } from "./live-rates";

/** The lines for what is live right now, in order; empty when nothing is. `today` is an ISO day. */
export const liveLines = (
  status: LiveStatus,
  vitals: LiveVitals,
  scheme: AtlasScheme,
  today: string,
): readonly string[] => {
  const moving = status.pulsing || status.breathing;
  const bodyParts3d = scheme === "bodyparts3d";
  return [
    ...(moving || status.glowing ? [ILLUSTRATIVE] : []),
    ...(status.pulsing && vitals.heart ? [pulseLine(vitals.heart, today)] : []),
    ...(status.pulsing && bodyParts3d ? [BODYPARTS3D_HEART_NOTE] : []),
    ...(status.breathing && vitals.breath ? [breathingLine(vitals.breath, today)] : []),
    ...(status.breathing && bodyParts3d ? [BODYPARTS3D_BREATH_NOTE] : []),
    ...(status.glowing && vitals.hrvBelow
      ? [hrvLine(vitals.hrvBelow, scheme, today)]
      : []),
  ];
};

export type LiveContext = Readonly<{
  /** The person's toggle; on by default in the environment. */
  on: boolean;
  inEnvironment: boolean;
  reducedMotion: boolean;
}>;

/**
 * One line when nothing moves although live vitals are expected: the subject
 * has no rate (said in the environment only, where live vitals are on by
 * default), or no heart or lung is drawn yet. Reduced motion says nothing:
 * there is no toggle and nothing moves on purpose.
 */
export const liveNote = (
  status: LiveStatus,
  vitals: LiveVitals,
  context: LiveContext,
): string | null => {
  if (context.reducedMotion || status.pulsing || status.breathing || status.glowing)
    return null;
  const hasRate =
    vitals.heart !== null || vitals.breath !== null || vitals.hrvBelow !== null;
  if (!hasRate) return context.inEnvironment ? NO_RATE : null;
  return context.on ? SHOW_ORGANS : null;
};

/**
 * Beside the 3D view, not inside its `role="application"`, so the lines read
 * as text. Shown while something moves or glows, or with the one note above.
 */
export const LiveLines = ({
  status,
  vitals,
  scheme,
  context,
}: Readonly<{
  status: LiveStatus;
  vitals: LiveVitals;
  scheme: AtlasScheme;
  context: LiveContext;
}>) => {
  // The viewer's own calendar day, so "today" means today where they are.
  const moving = liveLines(status, vitals, scheme, isoLocalDate());
  const note = liveNote(status, vitals, context);
  const lines = moving.length > 0 ? moving : note ? [note] : [];
  if (lines.length === 0) return null;
  return (
    <div className="twin-live-lines">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
};
