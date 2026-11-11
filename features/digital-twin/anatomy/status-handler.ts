import { NextResponse } from "next/server";

import { DEMO_BODY_IDS, type DemoBodyId } from "@/packages/anatomy/demo-bodies";
import { FITTED_ATLAS_IDS, type FittedAtlasId } from "@/packages/anatomy/fitted-atlases";
import { ATLAS_IDS, type AtlasId } from "@/packages/anatomy/manifest";
import { type SkeletonAtlas } from "@/packages/anatomy/open-skeleton";

/**
 * GET /api/anatomy/status: which atlases are installed, so the UI can say so up
 * front, which demo bodies have a baked rigged variant (the one that walks),
 * which Blender-fitted atlases are made here, with whether "Fit atlas to
 * body" starts on, and the open-anatomy skeleton's atlas.json when one is
 * configured (null: no skeleton layer).
 */
export type AnatomyStatusDeps = Readonly<{
  statAtlas: (id: AtlasId) => Promise<boolean>;
  statRiggedBody?: (id: DemoBodyId) => Promise<boolean>;
  statFittedAtlas?: (id: FittedAtlasId) => Promise<boolean>;
  /** ANATOMY_FITTED_ATLAS; off when absent. */
  fittedAtlasOn?: () => boolean;
  readSkeleton?: () => Promise<SkeletonAtlas | null>;
}>;

export type AnatomyStatus = Readonly<{
  atlases: readonly Readonly<{ id: AtlasId; installed: boolean }>[];
  riggedBodies: readonly Readonly<{ id: DemoBodyId; installed: boolean }>[];
  fittedAtlases: readonly Readonly<{ id: FittedAtlasId; installed: boolean }>[];
  fittedAtlasOn: boolean;
  skeleton: SkeletonAtlas | null;
}>;

const none = async (): Promise<boolean> => false;

export const createAnatomyStatusHandler = (deps: AnatomyStatusDeps) => {
  return async () => {
    const statRigged = deps.statRiggedBody ?? none;
    const statFitted = deps.statFittedAtlas ?? none;
    const readSkeleton = deps.readSkeleton ?? (async () => null);
    const [atlases, riggedBodies, fittedAtlases, skeleton] = await Promise.all([
      Promise.all(
        ATLAS_IDS.map(async (id) => ({ id, installed: await deps.statAtlas(id) })),
      ),
      Promise.all(
        DEMO_BODY_IDS.map(async (id) => ({ id, installed: await statRigged(id) })),
      ),
      Promise.all(
        FITTED_ATLAS_IDS.map(async (id) => ({ id, installed: await statFitted(id) })),
      ),
      readSkeleton(),
    ]);
    const body: AnatomyStatus = {
      atlases,
      riggedBodies,
      fittedAtlases,
      fittedAtlasOn: deps.fittedAtlasOn?.() ?? false,
      skeleton,
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  };
};
