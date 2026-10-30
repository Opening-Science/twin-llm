"use client";

import { isoLocalDate } from "@/infrastructure/format-measure";
import {
  CollapsiblePanel,
  usePanelOpen,
} from "@/infrastructure/ui-kit/collapsible-panel";
import { type AtlasScheme } from "@/packages/anatomy/manifest";

import { type LiveStatus } from "./live-conditioning";
import {
  BODYPARTS3D_BREATH_NOTE,
  BODYPARTS3D_HEART_NOTE,
  breathingLine,
  CHAMBERS_ILLUSTRATIVE,
  CHAMBERS_LINE,
  chambersTimingLine,
  hrvLine,
  ILLUSTRATIVE,
  LIVE_PANEL,
  NO_RATE,
  pulseLine,
  SHOW_ORGANS,
} from "./live-copy";
import { type HeartRhythm } from "./heart-rhythm";
import { type LiveVitals } from "./live-rates";

/** The lines for what is live right now, in order; empty when nothing is. `today` is an ISO day. */
export const liveLines = (
  status: LiveStatus,
  vitals: LiveVitals,
  scheme: AtlasScheme,
  today: string,
  timing: HeartRhythm["timing"] = "regular",
): readonly string[] => {
  const moving = status.pulsing || status.breathing;
  const bodyParts3d = scheme === "bodyparts3d";
  const chambers = status.pulsing ? status.chambers : null;
  return [
    ...(chambers !== null
      ? [CHAMBERS_ILLUSTRATIVE]
      : moving || status.glowing
        ? [ILLUSTRATIVE]
        : []),
    ...(status.pulsing && vitals.heart ? [pulseLine(vitals.heart, today)] : []),
    ...(chambers !== null ? [CHAMBERS_LINE, chambersTimingLine(timing, chambers)] : []),
    ...(status.pulsing && bodyParts3d ? [BODYPARTS3D_HEART_NOTE] : []),
    ...(status.breathing && vitals.breath ? [breathingLine(vitals.breath, today)] : []),
    ...(status.breathing && bodyParts3d ? [BODYPARTS3D_BREATH_NOTE] : []),
    ...(status.glowing && vitals.hrvBelow
      ? [hrvLine(vitals.hrvBelow, scheme, today)]
      : []),
  ];
};

/** The stored key of the live-vitals box (infrastructure/ui-kit/panel-memory.ts). */
export const LIVE_PANEL_ID = "twin-live";

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
 * `extra` lines (whole-body motion) follow in the same box, so the two never
 * overlap at the bottom left of the environment. The box folds under its
 * title like every viewer panel, remembered per viewer.
 */
export const LiveLines = ({
  status,
  vitals,
  scheme,
  timing,
  context,
  extra = [],
}: Readonly<{
  status: LiveStatus;
  vitals: LiveVitals;
  /** Where the heart chambers' beat times come from. */
  timing: HeartRhythm["timing"];
  scheme: AtlasScheme;
  context: LiveContext;
  extra?: readonly string[];
}>) => {
  // The viewer's own calendar day, so "today" means today where they are.
  const moving = liveLines(status, vitals, scheme, isoLocalDate(), timing);
  const note = liveNote(status, vitals, context);
  const lines = [...(moving.length > 0 ? moving : note ? [note] : []), ...extra];
  const [open, onToggle] = usePanelOpen(LIVE_PANEL_ID);
  if (lines.length === 0) return null;
  return (
    <CollapsiblePanel
      label={LIVE_PANEL}
      open={open}
      onToggle={onToggle}
      className="twin-live-lines"
    >
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </CollapsiblePanel>
  );
};
