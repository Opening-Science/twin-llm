import { NextResponse } from "next/server";

import { ATLAS_IDS, type AtlasId } from "@/packages/anatomy/manifest";

/** GET /api/anatomy/status: which atlases are installed, so the UI can say so up front. */
export type AnatomyStatusDeps = Readonly<{
  statAtlas: (id: AtlasId) => Promise<boolean>;
}>;

export type AnatomyStatus = Readonly<{
  atlases: readonly Readonly<{ id: AtlasId; installed: boolean }>[];
}>;

export const createAnatomyStatusHandler = (deps: AnatomyStatusDeps) => {
  return async () => {
    const atlases = await Promise.all(
      ATLAS_IDS.map(async (id) => ({ id, installed: await deps.statAtlas(id) })),
    );
    const body: AnatomyStatus = { atlases };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  };
};
