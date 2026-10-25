import { normaliseGroup } from "@/packages/anatomy/hra-groups";
import { type Highlight } from "@/packages/anatomy/highlight";
import { type AtlasScheme } from "@/packages/anatomy/manifest";
import {
  markerHighlight,
  NOT_IN_ATLAS,
  vitalHighlight,
  type RowHighlight,
} from "@/packages/biomarkers/marker-highlight";

import { type AnatomyLoad } from "../anatomy/anatomy-state";
import { SEE_WITH_DEPTH } from "./biomarker-copy";
import { type BiomarkerRow } from "./biomarker-rows";

type ReadyLoad = Extract<AnatomyLoad, { kind: "ready" }>;

export type AtlasView = Readonly<{
  requested: boolean;
  ready: Pick<ReadyLoad, "groups" | "partSystems"> | null;
}>;

export const rowHighlight = (row: BiomarkerRow, scheme: AtlasScheme): RowHighlight =>
  row.source.kind === "marker"
    ? markerHighlight(row.source.anatomy, scheme)
    : vitalHighlight(row.source.anatomy, scheme);

/** Whether the loaded atlas has a mesh the highlight can light. */
export const lightsSomething = (
  highlight: Highlight,
  ready: Pick<ReadyLoad, "groups" | "partSystems">,
): boolean =>
  highlight.kind === "system"
    ? highlight.ids.some((system) => ready.partSystems.includes(system))
    : highlight.ids.some((id) =>
        ready.groups.some((group) => group.key === normaliseGroup(id)),
      );

/**
 * The lines under a selected row: why nothing lights, or how to see it. The
 * atlas loads only once someone moves past the scan, and the highlight never
 * moves the depth (G1), so before that the row says where to look.
 */
export const rowNotes = (lit: RowHighlight, atlas: AtlasView): readonly string[] => {
  const notes = lit.note ? [lit.note] : [];
  if (!lit.highlight) return notes;
  if (!atlas.requested) return [...notes, SEE_WITH_DEPTH];
  if (atlas.ready && !lightsSomething(lit.highlight, atlas.ready)) {
    return [...notes, NOT_IN_ATLAS];
  }
  return notes;
};
