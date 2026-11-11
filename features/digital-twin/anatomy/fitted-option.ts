import { type DemoBodyId } from "@/packages/anatomy/demo-bodies";
import {
  FITTED_ATLAS_IDS,
  fittedAtlasId,
  isFittedAtlasId,
  type FittedAtlasId,
} from "@/packages/anatomy/fitted-atlases";
import { type AtlasId } from "@/packages/anatomy/manifest";
import { DEMO_STANCE, type DemoStance } from "@/packages/anatomy/stance";

/**
 * "Fit atlas to body" (#525's per-limb Blender fit, bone lengths kept): when
 * it is offered, when it shows, and what stance the body takes. Pure, so the
 * viewer only wires it.
 */
export type FittedInstalled = Readonly<Record<FittedAtlasId, boolean>>;

/** What the viewer knows when it decides. */
export type FittedContext = Readonly<{
  /** The demo body shown; null for a BodyLoop scan, which is never refitted. */
  bodyId: DemoBodyId | null;
  /** The rigged body is the one the fit was made on; the static one is posed differently. */
  rigged: boolean;
  atlasId: AtlasId;
  /** From the status; null until it answers. */
  installed: FittedInstalled | null;
}>;

/** The toggle shows only where the fitted file for this body and atlas is made here. */
export const fittedAvailable = (context: FittedContext): boolean =>
  context.bodyId !== null &&
  context.rigged &&
  context.installed?.[fittedAtlasId(context.bodyId, context.atlasId)] === true;

/** The fitted atlas shows when it is ticked and available; otherwise the usual fit. */
export const fittedShown = (fitAtlas: boolean, context: FittedContext): boolean =>
  fitAtlas && fittedAvailable(context);

/** The fit was made on the unposed body, so the #518 stance is 0° while it shows. */
export const UNPOSED: DemoStance = { hipAdductionDeg: 0 };

export const demoStanceFor = (
  bodyId: DemoBodyId,
  atlasId: AtlasId,
  fitted: boolean,
): DemoStance => (fitted ? UNPOSED : DEMO_STANCE[bodyId][atlasId]);

type StatusRow = { readonly id?: unknown; readonly installed?: unknown };

/** Which fitted atlases the status lists as made here; all false for an older or odd body. */
export const parseFittedStatus = (value: unknown): FittedInstalled => {
  const installed = Object.fromEntries(
    FITTED_ATLAS_IDS.map((id) => [id, false]),
  ) as Record<FittedAtlasId, boolean>;
  const rows: unknown =
    value && typeof value === "object"
      ? (value as { fittedAtlases?: unknown }).fittedAtlases
      : null;
  if (!Array.isArray(rows)) return installed;
  for (const row of rows as readonly unknown[]) {
    if (!row || typeof row !== "object") continue;
    const { id, installed: present } = row as StatusRow;
    if (isFittedAtlasId(id) && present === true) installed[id] = true;
  }
  return installed;
};

/** ANATOMY_FITTED_ATLAS as the status reports it; anything but `true` is off. */
export const parseFittedDefault = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  (value as { fittedAtlasOn?: unknown }).fittedAtlasOn === true;
