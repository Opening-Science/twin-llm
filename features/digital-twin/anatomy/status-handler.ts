import { NextResponse } from "next/server";

import { DEMO_BODY_IDS, type DemoBodyId } from "@/packages/anatomy/demo-bodies";
import { ATLAS_IDS, type AtlasId } from "@/packages/anatomy/manifest";
import { type SkeletonAtlas } from "@/packages/anatomy/open-skeleton";

/**
 * GET /api/anatomy/status: which atlases are installed, so the UI can say so up
 * front, which demo bodies have a baked rigged variant (the one that walks),
 * and the open-anatomy skeleton's atlas.json when one is configured (null: no
 * skeleton layer).
 */
export type AnatomyStatusDeps = Readonly<{
  statAtlas: (id: AtlasId) => Promise<boolean>;
  statRiggedBody?: (id: DemoBodyId) => Promise<boolean>;
  readSkeleton?: () => Promise<SkeletonAtlas | null>;
}>;

export type AnatomyStatus = Readonly<{
  atlases: readonly Readonly<{ id: AtlasId; installed: boolean }>[];
  riggedBodies: readonly Readonly<{ id: DemoBodyId; installed: boolean }>[];
  skeleton: SkeletonAtlas | null;
}>;

export const createAnatomyStatusHandler = (deps: AnatomyStatusDeps) => {
  return async () => {
    const statRigged = deps.statRiggedBody ?? (async () => false);
    const readSkeleton = deps.readSkeleton ?? (async () => null);
    const [atlases, riggedBodies, skeleton] = await Promise.all([
      Promise.all(
        ATLAS_IDS.map(async (id) => ({ id, installed: await deps.statAtlas(id) })),
      ),
      Promise.all(
        DEMO_BODY_IDS.map(async (id) => ({ id, installed: await statRigged(id) })),
      ),
      readSkeleton(),
    ]);
    const body: AnatomyStatus = { atlases, riggedBodies, skeleton };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  };
};
