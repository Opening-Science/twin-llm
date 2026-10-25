import {
  DEMO_BODIES,
  demoBodyVersion,
  isDemoBodyId,
  type DemoBodyId,
} from "@/packages/anatomy/demo-bodies";
import {
  ATLASES,
  atlasVersion,
  isAtlasId,
  type AtlasId,
} from "@/packages/anatomy/manifest";

import { ANATOMY_NOT_INSTALLED_API } from "./anatomy-copy";
import { DEMO_NOT_INSTALLED_API } from "./demo-copy";
import { createPinnedGlbHandler } from "./pinned-glb-handler";

export { matchesEtag } from "./pinned-glb-handler";

/**
 * GET /api/anatomy/atlas/:atlasId. Atlases are public CC BY files from a closed
 * list; caching and 404 rules live in the shared pinned-GLB handler.
 */
export type AnatomyAtlasDeps = Readonly<{
  openAtlas: (id: AtlasId) => Promise<Uint8Array<ArrayBuffer> | null>;
}>;

export const createAnatomyAtlasHandler = (deps: AnatomyAtlasDeps) =>
  createPinnedGlbHandler<AtlasId>({
    param: "atlasId",
    isId: isAtlasId,
    sha256: (id) => ATLASES[id].sha256,
    version: atlasVersion,
    open: deps.openAtlas,
    notInstalled: ANATOMY_NOT_INSTALLED_API,
  });

/**
 * GET /api/anatomy/demo/:bodyId. The synthetic ANNY demo bodies: public
 * Apache-2.0 / CC0 files from a closed list, served by the same rules.
 */
export type DemoBodyDeps = Readonly<{
  openDemoBody: (id: DemoBodyId) => Promise<Uint8Array<ArrayBuffer> | null>;
}>;

export const createDemoBodyHandler = (deps: DemoBodyDeps) =>
  createPinnedGlbHandler<DemoBodyId>({
    param: "bodyId",
    isId: isDemoBodyId,
    sha256: (id) => DEMO_BODIES[id].sha256,
    version: demoBodyVersion,
    open: deps.openDemoBody,
    notInstalled: DEMO_NOT_INSTALLED_API,
  });
