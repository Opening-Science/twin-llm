import { NextResponse } from "next/server";

import { DEMO_BODY_IDS, type DemoBodyId } from "@/packages/anatomy/demo-bodies";
import { ATLAS_IDS, type AtlasId } from "@/packages/anatomy/manifest";

/**
 * GET /api/anatomy/status: which atlases are installed, so the UI can say so up
 * front, and which demo bodies have a baked rigged variant (the one that walks).
 */
export type AnatomyStatusDeps = Readonly<{
  statAtlas: (id: AtlasId) => Promise<boolean>;
  statRiggedBody?: (id: DemoBodyId) => Promise<boolean>;
}>;

export type AnatomyStatus = Readonly<{
  atlases: readonly Readonly<{ id: AtlasId; installed: boolean }>[];
  riggedBodies: readonly Readonly<{ id: DemoBodyId; installed: boolean }>[];
}>;

export const createAnatomyStatusHandler = (deps: AnatomyStatusDeps) => {
  return async () => {
    const statRigged = deps.statRiggedBody ?? (async () => false);
    const [atlases, riggedBodies] = await Promise.all([
      Promise.all(
        ATLAS_IDS.map(async (id) => ({ id, installed: await deps.statAtlas(id) })),
      ),
      Promise.all(
        DEMO_BODY_IDS.map(async (id) => ({ id, installed: await statRigged(id) })),
      ),
    ]);
    const body: AnatomyStatus = { atlases, riggedBodies };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  };
};
