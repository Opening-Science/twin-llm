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
 * "Fit atlas to body": when it is offered, which fit it shows, and what
 * stance the body takes. Two fits sit behind the one switch. The segment fit
 * is made in the browser for any body with a known skeleton, a scan
 * included. Where #525's Blender-fitted file for a rigged demo body is made
 * here, that file shows instead, as before. Pure, so the viewer only wires it.
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
  /** The body has a skeleton the clips can bind to; the segment fit needs it. */
  skeleton: boolean;
}>;

/** The Blender-fitted file for this body and atlas is made here. */
const fileMade = (context: FittedContext): boolean =>
  context.bodyId !== null &&
  context.rigged &&
  context.installed?.[fittedAtlasId(context.bodyId, context.atlasId)] === true;

/** The toggle shows where either fit can be made. */
export const fittedAvailable = (context: FittedContext): boolean =>
  context.skeleton || fileMade(context);

/** The Blender-fitted atlas shows when the toggle is ticked and its file is made here. */
export const fittedShown = (fitAtlas: boolean, context: FittedContext): boolean =>
  fitAtlas && fileMade(context);

/** The segment fit shows when the toggle is ticked and no fitted file takes its place. */
export const segmentFitShown = (fitAtlas: boolean, context: FittedContext): boolean =>
  fitAtlas && context.skeleton && !fileMade(context);

/** Either fit lays the atlas on the body as it stands, so the #518 stance is 0° while one shows. */
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
