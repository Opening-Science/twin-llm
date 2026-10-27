import { partsFor, type AtlasGroup, type Highlight } from "@/packages/anatomy/highlight";
import {
  applyMask,
  layerMix,
  partShown,
  type AtlasLayerId,
  type LayerMix,
} from "@/packages/anatomy/layers";
import { type AtlasScheme } from "@/packages/anatomy/manifest";
import { isSystemId, type OrganSystem } from "@/packages/anatomy/systems";

import { SYSTEM_LABEL } from "../anatomy/anatomy-copy";
import { type BiomarkerRow } from "../biomarkers/biomarker-rows";
import { rowHighlight } from "../biomarkers/row-highlight";

/**
 * What a click in the environment lands on, as plain data, so the choice is
 * testable without a renderer. The raycast returns every mesh under the
 * pointer, nearest first; the depth slider decides which of them reads as
 * the thing you clicked. Glass is looked through: at the organ stop the scan
 * and skeleton are glass, so a click on the belly is the liver behind them,
 * not the skin in front.
 */

export type PickablePart = Readonly<{
  layer: AtlasLayerId;
  system: OrganSystem;
  /** Normalised HRA group key; null on BodyParts3D. */
  group: string | null;
  ontologyId: string | null;
}>;

export type PickHit<P extends PickablePart> = Readonly<{
  /** null for the body outline (the scan or the demo body). */
  part: P | null;
}>;

/** A layer that has mostly faded in and is not glass reads as solid. */
const solid = (mix: LayerMix): boolean =>
  mix.visible && mix.alpha >= 0.5 && mix.fade < 0.5;

/**
 * The hit that was meant, by index, or null when nothing drawn was hit. First
 * the nearest solid surface; else the nearest visible atlas part (all glass,
 * as at the skeleton stop with organs off); else the body outline.
 */
export const choosePick = <P extends PickablePart>(
  hits: readonly PickHit<P>[],
  depth: number,
  layers: Readonly<Record<AtlasLayerId, boolean>>,
  hiddenSystems: readonly OrganSystem[],
): number | null => {
  const envelope = layerMix("scan", depth);
  const mixOf = (hit: PickHit<P>): LayerMix =>
    hit.part
      ? applyMask(
          layerMix(hit.part.layer, depth),
          partShown(hit.part, layers, hiddenSystems),
        )
      : envelope;
  const mixes = hits.map(mixOf);
  const firstSolid = mixes.findIndex(solid);
  if (firstSolid >= 0) return firstSolid;
  const firstPart = hits.findIndex(
    (hit, index) => hit.part !== null && mixes[index]!.visible,
  );
  if (firstPart >= 0) return firstPart;
  const outline = hits.findIndex(
    (hit, index) => hit.part === null && mixes[index]!.visible,
  );
  return outline >= 0 ? outline : null;
};

/** Pointer travel and time under which a press counts as a tap, not a drag. */
export const TAP_SLOP_PX = 6;
export const TAP_MAX_MS = 500;

export type PointerSample = Readonly<{ x: number; y: number; t: number }>;

export const isTap = (down: PointerSample, up: PointerSample): boolean =>
  Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP_PX && up.t - down.t <= TAP_MAX_MS;

export type PickTarget =
  | Readonly<{
      kind: "part";
      label: string;
      layer: AtlasLayerId;
      system: OrganSystem;
      group: string | null;
      ontologyId: string | null;
    }>
  | Readonly<{ kind: "body" }>;

export type Picked = Readonly<{
  target: PickTarget;
  /** Where the ray met it, in world space, for the card to sit beside. */
  point: readonly [number, number, number];
}>;

/** HRA parts read as their organ group ("Liver"); BodyParts3D parts as their system. */
export const pickTarget = (
  part: PickablePart | null,
  groups: readonly AtlasGroup[],
): PickTarget => {
  if (!part) return { kind: "body" };
  const group = part.group ? groups.find((known) => known.key === part.group) : undefined;
  return {
    kind: "part",
    label: group?.label ?? SYSTEM_LABEL[part.system],
    layer: part.layer,
    system: part.system,
    group: part.group,
    ontologyId: part.ontologyId,
  };
};

/** What a pick lights: its organ group, else its system, else nothing. */
export const pickHighlight = (target: PickTarget): Highlight | null => {
  if (target.kind !== "part") return null;
  if (target.group !== null) return { kind: "groups", ids: [target.group] };
  return isSystemId(target.system) ? { kind: "system", ids: [target.system] } : null;
};

/**
 * Whether a click on this part lights something: every part the atlas keeps
 * must be (prepare-atlas.ts gives a part without a group or known system a
 * key from its node name).
 */
export const isSelectable = (
  part: PickablePart,
  groups: readonly AtlasGroup[],
): boolean => pickHighlight(pickTarget(part, groups)) !== null;

/**
 * What a pick lights on each atlas kind, so an atlas switch keeps something
 * lit. Group keys belong to one atlas; every known system exists on both, so
 * the other atlas lights the picked part's whole system.
 */
export const pickHighlights = (
  target: PickTarget,
  scheme: AtlasScheme,
): Readonly<Record<AtlasScheme, Highlight | null>> => {
  if (target.kind !== "part") return { hra: null, bodyparts3d: null };
  const system: Highlight | null = isSystemId(target.system)
    ? { kind: "system", ids: [target.system] }
    : null;
  return {
    hra: scheme === "hra" ? pickHighlight(target) : null,
    bodyparts3d: scheme === "bodyparts3d" ? pickHighlight(target) : system,
  };
};

/**
 * Whether the picked part still draws: the same mix and toggles the scene
 * uses. A card for a part that a toggle or the slider has hidden closes. The
 * body outline always draws (it turns to glass, never away).
 */
export const pickVisible = (
  target: PickTarget,
  depth: number,
  layers: Readonly<Record<AtlasLayerId, boolean>>,
  hiddenSystems: readonly OrganSystem[],
): boolean =>
  target.kind !== "part" ||
  applyMask(layerMix(target.layer, depth), partShown(target, layers, hiddenSystems))
    .visible;

/**
 * Biomarker rows whose own highlight (G2) would light the picked part. The
 * same rules, read backwards, so a card never links a marker its row would
 * not light.
 */
export const linkedRows = (
  target: PickTarget,
  rows: readonly BiomarkerRow[],
  scheme: AtlasScheme,
): readonly BiomarkerRow[] => {
  if (target.kind !== "part") return [];
  const part = { group: target.group, system: target.system };
  return rows.filter((row) => {
    const lit = rowHighlight(row, scheme).highlight;
    return lit !== null && partsFor(lit, [part]).length > 0;
  });
};
