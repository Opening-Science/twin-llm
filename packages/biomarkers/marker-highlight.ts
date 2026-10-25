/**
 * What a Biomarkers-tab row lights on the loaded atlas. The two atlas kinds
 * read the region table differently: HRA lights single organ groups,
 * BodyParts3D only whole systems (see region-anatomy.ts).
 *
 * On HRA a marker whose regions have no HRA group (the glands, skeletal muscle)
 * lights nothing and says "Not in this atlas"; the "whole system shown" notes
 * are true only on BodyParts3D.
 */
import { type Highlight } from "@/packages/anatomy/highlight";
import { type AtlasScheme } from "@/packages/anatomy/manifest";

import { type MarkerAnatomy } from "./region-anatomy";
import { type VitalAnatomy } from "./vitals";

export const NOT_IN_ATLAS = "Not in this atlas.";

export type RowHighlight = Readonly<{ highlight: Highlight | null; note?: string }>;

const unique = <T>(items: readonly T[]): readonly T[] => [...new Set(items)];

export const markerHighlight = (
  anatomy: MarkerAnatomy,
  scheme: AtlasScheme,
): RowHighlight => {
  if (anatomy.targets.length === 0) return { highlight: null, note: anatomy.note };
  if (scheme === "hra") {
    const ids = unique(anatomy.targets.flatMap((target) => target.hraGroups));
    return ids.length > 0
      ? { highlight: { kind: "groups", ids } }
      : { highlight: null, note: NOT_IN_ATLAS };
  }
  const systems = unique(
    anatomy.targets.flatMap((target) =>
      target.bodyParts3dSystem ? [target.bodyParts3dSystem] : [],
    ),
  );
  if (systems.length === 0) return { highlight: null, note: NOT_IN_ATLAS };
  const highlight: Highlight = { kind: "system", ids: systems };
  return anatomy.note ? { highlight, note: anatomy.note } : { highlight };
};

/** A vital lights its HRA groups, or its whole system where it has none. */
export const vitalHighlight = (vital: VitalAnatomy, scheme: AtlasScheme): RowHighlight =>
  scheme === "hra" && vital.hraGroups.length > 0
    ? { highlight: { kind: "groups", ids: vital.hraGroups } }
    : { highlight: { kind: "system", ids: [vital.system] } };
